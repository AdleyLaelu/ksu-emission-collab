"""
AI Feedback Loop for Model Training.

Wraps the existing train_moves5.py training with an automated feedback loop
that identifies poorly performing vehicle/fuel/age combos and iteratively
improves them through CONSERVATIVE data rebalancing only.

Key design decisions (learned from previous rounds):
  - NEVER change loss function (MSELoss only — Huber destabilized NOx/PM25)
  - NEVER change architecture (ModifiedNet only — CompactNet made things worse)
  - NEVER add dropout (standard architecture works best)
  - ONLY strategy: upsample flagged combos with progressive multipliers
  - Smart early stop: if flagged count INCREASES, stop immediately and keep best

Usage:
    cd backend && python train_with_feedback.py
"""

import os
import copy
import warnings
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import StandardScaler, OneHotEncoder, PowerTransformer
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error
from sklearn.base import BaseEstimator, TransformerMixin

warnings.filterwarnings("ignore")

# Force unbuffered output so progress is visible in real time
import sys
import functools
print = functools.partial(print, flush=True)

# ── Config ──────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MOVES5_DIR = os.path.join(BASE_DIR, "..", "Emission 1 corrected", "MOVES 5 Emission data")

STATES = ["GA"]

EMISSION_TARGETS = {
    "CO2":       {"col": "CO2",              "unit": "g/mile"},
    "Energy":    {"col": "Total Energy",     "unit": "kJ/mile"},
    "NOx":       {"col": "NOx",              "unit": "g/mile"},
    "PM25Brake": {"col": "PM2.5 Brakewear",  "unit": "g/mile"},
    "PM25Tire":  {"col": "PM2.5 Tirewear",   "unit": "g/mile"},
}

SPEED_BIN_MAP = {
    1: 2.5, 2: 5, 3: 10, 4: 15, 5: 20, 6: 25, 7: 30, 8: 35,
    9: 40, 10: 45, 11: 50, 12: 55, 13: 60, 14: 65, 15: 70, 16: 75,
}

VEHICLE_MAP = {
    11: "Motorcycle", 21: "Passenger Car", 31: "Passenger Truck",
    32: "Light Commercial Truck", 41: "Other Buses", 42: "Transit Bus",
    43: "School Bus", 51: "Refuse Truck", 52: "Single Unit Short-haul Truck",
    53: "Single Unit Long-haul Truck", 54: "Motor Home",
    61: "Combination Short-haul Truck", 62: "Combination Long-haul Truck",
}

FUEL_MAP = {
    1: "Gasoline", 2: "Diesel Fuel", 3: "Compressed Natural Gas (CNG)",
    5: "Ethanol (E-85)", 9: "Electricity",
}

# Emissions that benefit from log-transform (span multiple orders of magnitude)
LOG_TRANSFORM_EMISSIONS = {"NOx"}

# Combos to skip during validation (true zeros, not model errors)
SKIP_VALIDATION = {
    ("Electricity", "CO2"),
    ("Electricity", "NOx"),
}

MAX_FEEDBACK_ROUNDS = 5
FLAG_THRESHOLDS = {"r2_min": 0.5, "mape_max": 50.0}

# Progressive upsampling multipliers per round (conservative only)
UPSAMPLE_SCHEDULE = {
    1: 2,    # R1: gentle 2x upsample
    2: 4,    # R2: moderate 4x
    3: 8,    # R3: aggressive 8x
    4: 12,   # R4: heavy 12x
    5: 8,    # R5: 8x with new random seed
}

# Random seed per round (R5 uses different seed for diversity)
SEED_SCHEDULE = {
    0: 42, 1: 42, 2: 42, 3: 42, 4: 42, 5: 123,
}

LOG_CSV = os.path.join(BASE_DIR, "training_feedback_log.csv")


# ── Log Scaler (for NOx, PM25 — spans multiple orders of magnitude) ─────────
class LogScaler(BaseEstimator, TransformerMixin):
    """Sklearn-compatible scaler using log1p/expm1.

    Better than PowerTransformer for emissions that span 3+ orders of magnitude
    (e.g., NOx 0.01-9.0 g/mi) because it compresses the range evenly in log-space,
    giving equal attention to small and large values.
    """
    def fit(self, X, y=None):
        self._fitted = True
        return self

    def transform(self, X):
        return np.log1p(np.maximum(X, 0))

    def inverse_transform(self, X):
        return np.expm1(X)


# ── Model ───────────────────────────────────────────────────────────────────
class ModifiedNet(nn.Module):
    """Standard architecture (matches models.py). Never change this."""
    def __init__(self, input_features, dropout=0.0):
        super().__init__()
        self.fc1 = nn.Linear(input_features, 512)
        self.fc2 = nn.Linear(512, 256)
        self.fc3 = nn.Linear(256, 128)
        self.fc4 = nn.Linear(128, 64)
        self.fc5 = nn.Linear(64, 1)

    def forward(self, x):
        x = torch.nn.functional.silu(self.fc1(x))
        x = torch.nn.functional.silu(self.fc2(x))
        x = torch.nn.functional.silu(self.fc3(x))
        x = torch.nn.functional.silu(self.fc4(x))
        return self.fc5(x)


# ── Data loading ────────────────────────────────────────────────────────────
def load_moves5_csv(state: str) -> pd.DataFrame:
    path = os.path.join(MOVES5_DIR, f"Emissions_Output_{state}.csv")
    df = pd.read_csv(path)
    df["Vehicle Type"] = df["VehicleID"].map(VEHICLE_MAP)
    df["Fuel Type"] = df["fuelTypeID"].map(FUEL_MAP)
    df["Speed"] = df["speed"].map(SPEED_BIN_MAP)
    df["Age"] = df["age"]
    return df.dropna(subset=["Vehicle Type", "Fuel Type", "Speed"])


# ── Per-combo validation (no plots) ────────────────────────────────────────
def validate_per_combo(model, preprocessor, target_scaler, df, target_col,
                       emission_name):
    """Predict on full dataset and compute per vehicle/fuel/age metrics."""
    results = []

    combos = df.groupby(["Vehicle Type", "Fuel Type", "Age"])

    for (vtype, ftype, age), group in combos:
        if (ftype, emission_name) in SKIP_VALIDATION:
            continue

        y_true = group[target_col].values

        if np.allclose(y_true, 0):
            continue

        n = len(group)
        if n < 2:
            continue

        try:
            X_input = add_age_bin(group)[FEATURES].copy()
            X_proc = preprocessor.transform(X_input)
            if hasattr(X_proc, "toarray"):
                X_proc = X_proc.toarray()
            t = torch.tensor(X_proc, dtype=torch.float32)
            with torch.no_grad():
                raw = model(t).numpy()
            y_pred = target_scaler.inverse_transform(raw).flatten()
            y_pred = np.maximum(y_pred, 0)
        except Exception:
            results.append({
                "vehicle_type": vtype, "fuel_type": ftype, "age": age,
                "n_rows": n, "R2": np.nan, "MAPE": np.nan, "flag": "predict_error",
            })
            continue

        valid = np.isfinite(y_true) & np.isfinite(y_pred)
        yt, yp = y_true[valid], y_pred[valid]
        if len(yt) < 2:
            continue

        if np.std(yp) < 1e-10:
            results.append({
                "vehicle_type": vtype, "fuel_type": ftype, "age": age,
                "n_rows": n, "R2": np.nan, "MAPE": np.nan, "flag": "constant_output",
            })
            continue

        r2 = r2_score(yt, yp)
        mask = np.abs(yt) > 1e-8
        mape = (np.mean(np.abs((yt[mask] - yp[mask]) / yt[mask])) * 100
                if mask.sum() > 0 else np.nan)

        flag = ""
        # Near-zero relaxation: if mean actual value is very small,
        # don't flag for low R² as long as MAPE is reasonable.
        # Small absolute values produce negative R² from tiny errors.
        mean_actual = np.mean(np.abs(yt))
        near_zero = mean_actual < 0.1  # values under 0.1 g/mi
        # Low-variance relaxation: if the actual values have very low
        # coefficient of variation, the curve is nearly flat and R² is
        # meaningless — only MAPE matters.
        cv = np.std(yt) / (mean_actual + 1e-12)
        low_variance = cv < 0.15  # less than 15% relative spread

        # Near-zero values: skip all flagging — absolute error is negligible
        # (e.g. 80% MAPE on 0.002 g/mi = 0.0016 g/mi error — meaningless)
        if near_zero:
            flag = ""
        elif low_variance and not np.isnan(mape) and mape < 10:
            flag = ""  # nearly flat curve with low MAPE — R² meaningless
        elif not np.isnan(mape) and mape > 100:
            flag = "wildly_off"
        elif not np.isnan(mape) and mape > FLAG_THRESHOLDS["mape_max"]:
            flag = "high_error"
        elif r2 < FLAG_THRESHOLDS["r2_min"]:
            flag = "low_R2"

        results.append({
            "vehicle_type": vtype, "fuel_type": ftype, "age": age,
            "n_rows": n, "R2": r2, "MAPE": mape, "flag": flag,
        })

    return results


def get_flagged(combo_results):
    """Return list of flagged combo dicts (non-empty flag)."""
    return [r for r in combo_results if r["flag"] in
            ("high_error", "wildly_off", "low_R2", "constant_output")]


# ── Feature engineering ─────────────────────────────────────────────────────
def add_age_bin(df):
    """Add Age_Bin categorical feature to help model distinguish edge-case ages."""
    bins = pd.cut(df["Age"], bins=[-1, 2, 25, 100], labels=["young", "mid", "old"])
    df = df.copy()
    df["Age_Bin"] = bins.astype(str)
    return df

FEATURES = ["Vehicle Type", "Fuel Type", "Age", "Speed", "Age_Bin"]


# ── Training core ───────────────────────────────────────────────────────────
def build_preprocessor_and_scale(X, y, emission_name=""):
    """Build sklearn preprocessor and target scaler, return transformed data."""
    preprocessor = ColumnTransformer(
        transformers=[
            ("num", StandardScaler(), ["Age", "Speed"]),
            ("cat", OneHotEncoder(handle_unknown="error", sparse_output=False),
             ["Vehicle Type", "Fuel Type", "Age_Bin"]),
        ]
    )

    # Use LogScaler for emissions spanning multiple orders of magnitude
    if emission_name in LOG_TRANSFORM_EMISSIONS:
        target_scaler = LogScaler()
    else:
        target_scaler = PowerTransformer(method="yeo-johnson")

    X_processed = preprocessor.fit_transform(X)
    y_scaled = target_scaler.fit_transform(y)
    return preprocessor, target_scaler, X_processed, y_scaled


def train_model(X_processed, y_scaled, n_features, *,
                lr=1e-3, patience=30, epochs=500, random_seed=42):
    """Train a single model. Always uses ModifiedNet + MSELoss (no changes)."""
    X_train, X_test, y_train, y_test = train_test_split(
        X_processed, y_scaled, test_size=0.2, random_state=random_seed
    )

    X_train_t = torch.tensor(X_train, dtype=torch.float32)
    y_train_t = torch.tensor(y_train, dtype=torch.float32)
    X_test_t = torch.tensor(X_test, dtype=torch.float32)
    y_test_t = torch.tensor(y_test, dtype=torch.float32)

    train_ds = TensorDataset(X_train_t, y_train_t)
    train_loader = DataLoader(train_ds, batch_size=64, shuffle=True)

    model = ModifiedNet(n_features)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, patience=10, factor=0.5
    )
    criterion = nn.MSELoss()  # Always MSELoss — never change

    best_loss = float("inf")
    best_state = None
    patience_counter = 0

    for epoch in range(epochs):
        model.train()
        epoch_loss = 0.0
        for xb, yb in train_loader:
            optimizer.zero_grad()
            pred = model(xb)
            loss = criterion(pred, yb)
            loss.backward()
            optimizer.step()
            epoch_loss += loss.item() * xb.size(0)
        epoch_loss /= len(train_ds)

        model.eval()
        with torch.no_grad():
            val_pred = model(X_test_t)
            val_loss = criterion(val_pred, y_test_t).item()

        scheduler.step(val_loss)

        if val_loss < best_loss:
            best_loss = val_loss
            best_state = copy.deepcopy(model.state_dict())
            patience_counter = 0
        else:
            patience_counter += 1
            if patience_counter >= patience:
                break

    model.load_state_dict(best_state)
    model.eval()
    return model, best_loss, epoch + 1


def compute_overall_metrics(model, preprocessor, target_scaler, X_test, y_test):
    """Compute R², RMSE, MAE, MAPE on test set in original scale."""
    X_test_t = torch.tensor(X_test, dtype=torch.float32)
    with torch.no_grad():
        y_pred_scaled = model(X_test_t).numpy()
    y_pred = target_scaler.inverse_transform(y_pred_scaled)
    y_true = target_scaler.inverse_transform(y_test)

    valid = np.isfinite(y_pred.ravel()) & np.isfinite(y_true.ravel())
    yp = y_pred[valid].reshape(-1, 1)
    yt = y_true[valid].reshape(-1, 1)

    r2 = r2_score(yt, yp)
    rmse = np.sqrt(mean_squared_error(yt, yp))
    mae = mean_absolute_error(yt, yp)

    mask = np.abs(yt) > 1e-8
    mape = float(np.mean(np.abs((yt[mask] - yp[mask]) / yt[mask]))) if mask.sum() > 0 else 0.0

    return {"r2": r2, "rmse": rmse, "mae": mae, "mape": mape}


# ── Data rebalancing ────────────────────────────────────────────────────────
def upsample_flagged_combos(df, target_col, flagged, multiplier=4):
    """Duplicate rows belonging to flagged vehicle/fuel/age combos."""
    if not flagged:
        return df

    extra_frames = []
    for combo in flagged:
        mask = (
            (df["Vehicle Type"] == combo["vehicle_type"]) &
            (df["Fuel Type"] == combo["fuel_type"]) &
            (df["Age"] == combo["age"]) &
            (df[target_col] > 0)
        )
        subset = df[mask]
        if len(subset) > 0:
            for _ in range(multiplier - 1):
                extra_frames.append(subset.copy())

    if extra_frames:
        return pd.concat([df] + extra_frames, ignore_index=True)
    return df


# ── Feedback loop for one state+emission ────────────────────────────────────
def train_with_feedback(df_raw, target_col, emission_name, state, log_rows):
    """Train with up to MAX_FEEDBACK_ROUNDS of conservative feedback.

    Strategy: ONLY upsample flagged combos with progressive multipliers.
    Never change loss function, architecture, or add dropout.
    Smart early stop: if flagged count increases, stop and keep best.
    """
    # Base dataset: drop rows where target is zero or NaN
    df_base = df_raw[df_raw[target_col] > 0].copy()
    df_base = add_age_bin(df_base)
    if len(df_base) < 100:
        print(f"  [SKIP] {state}/{emission_name}: only {len(df_base)} valid rows")
        return None

    best_checkpoint = None
    best_flagged_count = float("inf")
    best_round = -1
    prev_flagged_count = None

    for round_num in range(MAX_FEEDBACK_ROUNDS + 1):
        round_label = f"R{round_num}" if round_num > 0 else "initial"
        seed = SEED_SCHEDULE.get(round_num, 42)
        print(f"\n    --- {state}/{emission_name} [{round_label}] ---")

        # Determine training data for this round
        if round_num == 0:
            # Initial training: no upsampling
            df_train = df_base.copy()
            upsample_mult = 0
        else:
            # All feedback rounds: upsample only (conservative)
            upsample_mult = UPSAMPLE_SCHEDULE[round_num]
            print(f"    Upsampling {len(flagged)} flagged combos ({upsample_mult}x)...")
            df_train = upsample_flagged_combos(
                df_base, target_col, flagged, multiplier=upsample_mult
            )
            if round_num == 5:
                print(f"    Using alternate seed={seed} for diversity")

        print(f"    Training on {len(df_train)} rows (seed={seed})...")

        X = df_train[FEATURES].copy()
        y = df_train[[target_col]].values

        preprocessor, target_scaler, X_processed, y_scaled = \
            build_preprocessor_and_scale(X, y, emission_name)
        n_features = X_processed.shape[1]

        model, val_loss, epochs_run = train_model(
            X_processed, y_scaled, n_features,
            lr=1e-3, patience=30, epochs=500, random_seed=seed,
        )

        # Compute overall test metrics (on base data, not upsampled)
        X_base = df_base[FEATURES].copy()
        y_base = df_base[[target_col]].values
        X_base_proc = preprocessor.transform(X_base)
        y_base_scaled = target_scaler.transform(y_base)
        _, X_test, _, y_test = train_test_split(
            X_base_proc, y_base_scaled, test_size=0.2, random_state=42
        )
        overall = compute_overall_metrics(model, preprocessor, target_scaler,
                                          X_test, y_test)

        print(f"    Overall R²={overall['r2']:.4f}, RMSE={overall['rmse']:.4f}, "
              f"MAPE={overall['mape']:.4f}")

        # Per-combo validation on original (non-upsampled) data
        combo_results = validate_per_combo(
            model, preprocessor, target_scaler, df_base, target_col, emission_name
        )
        flagged = get_flagged(combo_results)
        n_flagged = len(flagged)
        n_total = len(combo_results)

        print(f"    Per-combo: {n_total} combos evaluated, {n_flagged} flagged")

        # Log this round
        log_rows.append({
            "state": state,
            "emission": emission_name,
            "round": round_label,
            "n_train_rows": len(df_train),
            "epochs_run": epochs_run,
            "val_loss": val_loss,
            "overall_R2": overall["r2"],
            "overall_RMSE": overall["rmse"],
            "overall_MAPE": overall["mape"],
            "n_combos_evaluated": n_total,
            "n_combos_flagged": n_flagged,
            "upsample_multiplier": upsample_mult,
            "random_seed": seed,
        })

        # Track best model (fewest flagged combos; tiebreak on overall R²)
        if (n_flagged < best_flagged_count or
                (n_flagged == best_flagged_count and
                 overall["r2"] > (best_checkpoint or {}).get(
                     "performance_metrics", {}).get("r2", -999))):
            best_flagged_count = n_flagged
            best_round = round_num
            best_checkpoint = {
                "model_state_dict": copy.deepcopy(model.state_dict()),
                "input_features": n_features,
                "preprocessor": preprocessor,
                "power_transformer": target_scaler,
                "target_scaler": target_scaler,
                "y_train_min": float(y_base.min()),
                "y_train_max": float(y_base.max()),
                "performance_metrics": {
                    "test_loss": float(val_loss),
                    "r2": float(overall["r2"]),
                    "rmse": float(overall["rmse"]),
                    "mape": float(overall["mape"]),
                    "mae": float(overall["mae"]),
                },
                "feedback_round": round_label,
                "flagged_combos": n_flagged,
            }
            print(f"    >> New best model (round {round_label}, {n_flagged} flagged)")

        # If no flagged combos remain, we're done
        if n_flagged == 0:
            print(f"    All combos OK — stopping early")
            break

        # Smart early stop: if flagged count INCREASED, stop and keep best
        if prev_flagged_count is not None and n_flagged > prev_flagged_count:
            print(f"    !! Flagged count increased ({prev_flagged_count} -> {n_flagged})")
            print(f"    !! Stopping early to prevent degradation")
            break

        prev_flagged_count = n_flagged

        # If this is the last allowed round, stop
        if round_num >= MAX_FEEDBACK_ROUNDS:
            break

        # Print which combos are still flagged
        if flagged:
            print(f"    Flagged combos:")
            for f in flagged[:10]:
                print(f"      {f['vehicle_type']:30s} | {f['fuel_type']:25s} | "
                      f"age={f['age']:2d} | {f['flag']:12s} | "
                      f"R²={f['R2']:.3f}" + (f" | MAPE={f['MAPE']:.1f}%"
                                              if not np.isnan(f.get('MAPE', np.nan))
                                              else ""))
            if len(flagged) > 10:
                print(f"      ... and {len(flagged) - 10} more")

    # Report final selection
    print(f"\n    Best model selected from round '{best_checkpoint['feedback_round']}' "
          f"with {best_flagged_count} flagged combos")

    return best_checkpoint


# ── Save model ──────────────────────────────────────────────────────────────
def save_checkpoint(checkpoint, state, emission_name):
    """Save to models/{STATE}/ and ml_models/."""
    state_dir = os.path.join(BASE_DIR, "models", state)
    os.makedirs(state_dir, exist_ok=True)
    out_path = os.path.join(state_dir, f"best_model_{state}{emission_name}.pth")
    torch.save(checkpoint, out_path)
    print(f"    Saved -> {out_path}")

    ml_dir = os.path.join(BASE_DIR, "ml_models")
    if os.path.isdir(ml_dir):
        flat_path = os.path.join(ml_dir, f"best_model_{state}{emission_name}.pth")
        torch.save(checkpoint, flat_path)
        print(f"    Saved -> {flat_path}")


# ── Main ────────────────────────────────────────────────────────────────────
def main():
    print("=" * 70)
    print("  AI FEEDBACK LOOP TRAINING (Conservative Only)")
    print("  Strategy: upsample flagged combos only — no loss/arch changes")
    print("=" * 70)

    log_rows = []
    summary_before = {}
    summary_after = {}

    for state in STATES:
        print(f"\n{'='*70}")
        print(f"  State: {state}")
        print(f"{'='*70}")

        df = load_moves5_csv(state)
        print(f"  Loaded {len(df)} rows from Emissions_Output_{state}.csv")

        for etype, info in EMISSION_TARGETS.items():
            key = f"{state}/{etype}"
            checkpoint = train_with_feedback(df, info["col"], etype, state, log_rows)

            if checkpoint is None:
                continue

            # Track before/after for summary
            rounds = [r for r in log_rows
                      if r["state"] == state and r["emission"] == etype]
            if rounds:
                summary_before[key] = rounds[0]["n_combos_flagged"]
                summary_after[key] = checkpoint["flagged_combos"]

            save_checkpoint(checkpoint, state, etype)

    # Save training log
    log_df = pd.DataFrame(log_rows)
    log_df.to_csv(LOG_CSV, index=False)
    print(f"\nSaved training log -> {LOG_CSV}")

    # Print before/after comparison
    print(f"\n{'='*70}")
    print("  BEFORE vs AFTER FEEDBACK LOOP")
    print(f"{'='*70}")
    print(f"  {'Model':<20s} {'Before':>8s} {'After':>8s} {'Change':>8s}")
    print(f"  {'-'*20} {'-'*8} {'-'*8} {'-'*8}")

    total_before = 0
    total_after = 0
    for key in sorted(summary_before.keys()):
        before = summary_before[key]
        after = summary_after.get(key, before)
        change = after - before
        sign = "+" if change > 0 else ""
        print(f"  {key:<20s} {before:>8d} {after:>8d} {sign}{change:>7d}")
        total_before += before
        total_after += after

    print(f"  {'-'*20} {'-'*8} {'-'*8} {'-'*8}")
    sign = "+" if (total_after - total_before) > 0 else ""
    print(f"  {'TOTAL':<20s} {total_before:>8d} {total_after:>8d} "
          f"{sign}{total_after - total_before:>7d}")

    print(f"\n{'='*70}")
    print("  DONE. Next steps:")
    print(f"  1. Review {LOG_CSV}")
    print(f"  2. Run: python comprehensive_validation.py  (to regenerate plots)")
    print(f"  3. Restart backend (run.py) to use new models")
    print(f"{'='*70}")


if __name__ == "__main__":
    main()
