"""
AI Feedback Loop for Model Training.

Wraps the existing train_moves5.py training with an automated feedback loop
that identifies poorly performing vehicle/fuel/age combos and iteratively
improves them through data rebalancing, hyperparameter adjustment, and
architecture tweaks.

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

warnings.filterwarnings("ignore")

# Force unbuffered output so progress is visible in real time
import sys
import functools
print = functools.partial(print, flush=True)

# ── Config ──────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MOVES5_DIR = os.path.join(BASE_DIR, "..", "Emission 1 corrected", "MOVES 5 Emission data")

STATES = ["GA"]  # Set to ["CA", "GA", "NY", "WA"] for all states

EMISSION_TARGETS = {
    "CO2":       {"col": "CO2",              "unit": "g/mile"},
    "Energy":    {"col": "Total Energy",     "unit": "kWh/100km"},
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

# Combos to skip during validation (true zeros, not model errors)
SKIP_VALIDATION = {
    ("Electricity", "CO2"),
    ("Electricity", "NOx"),
}

MAX_FEEDBACK_ROUNDS = 3
FLAG_THRESHOLDS = {"r2_min": 0.5, "mape_max": 50.0}

LOG_CSV = os.path.join(BASE_DIR, "training_feedback_log.csv")


# ── Model ───────────────────────────────────────────────────────────────────
class ModifiedNet(nn.Module):
    """Standard architecture (matches models.py)."""
    def __init__(self, input_features, dropout=0.0):
        super().__init__()
        self.fc1 = nn.Linear(input_features, 512)
        self.fc2 = nn.Linear(512, 256)
        self.fc3 = nn.Linear(256, 128)
        self.fc4 = nn.Linear(128, 64)
        self.fc5 = nn.Linear(64, 1)
        self.dropout = nn.Dropout(dropout) if dropout > 0 else None

    def forward(self, x):
        x = torch.nn.functional.silu(self.fc1(x))
        if self.dropout:
            x = self.dropout(x)
        x = torch.nn.functional.silu(self.fc2(x))
        if self.dropout:
            x = self.dropout(x)
        x = torch.nn.functional.silu(self.fc3(x))
        if self.dropout:
            x = self.dropout(x)
        x = torch.nn.functional.silu(self.fc4(x))
        return self.fc5(x)


class CompactNet(nn.Module):
    """Smaller architecture for Round 3 (reduces overfitting)."""
    def __init__(self, input_features, dropout=0.1):
        super().__init__()
        self.fc1 = nn.Linear(input_features, 256)
        self.fc2 = nn.Linear(256, 128)
        self.fc3 = nn.Linear(128, 64)
        self.fc4 = nn.Linear(64, 1)
        self.dropout = nn.Dropout(dropout)

    def forward(self, x):
        x = torch.nn.functional.silu(self.fc1(x))
        x = self.dropout(x)
        x = torch.nn.functional.silu(self.fc2(x))
        x = self.dropout(x)
        x = torch.nn.functional.silu(self.fc3(x))
        return self.fc4(x)


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
    """Predict on full dataset and compute per vehicle/fuel/age metrics.

    Returns a list of dicts with keys:
        vehicle_type, fuel_type, age, n_rows, R2, MAPE, flag
    """
    features = ["Vehicle Type", "Fuel Type", "Age", "Speed"]
    results = []

    combos = df.groupby(["Vehicle Type", "Fuel Type", "Age"])

    for (vtype, ftype, age), group in combos:
        # Skip known true-zero combos
        if (ftype, emission_name) in SKIP_VALIDATION:
            continue

        y_true = group[target_col].values

        # Skip all-zero ground truth
        if np.allclose(y_true, 0):
            continue

        n = len(group)
        if n < 2:
            continue

        # Predict
        try:
            X_input = group[features].copy()
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

        # Filter valid
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
        if not np.isnan(mape) and mape > 100:
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


# ── Training core ───────────────────────────────────────────────────────────
def build_preprocessor_and_scale(X, y):
    """Build sklearn preprocessor and target scaler, return transformed data."""
    preprocessor = ColumnTransformer(
        transformers=[
            ("num", StandardScaler(), ["Age", "Speed"]),
            ("cat", OneHotEncoder(handle_unknown="error", sparse_output=False),
             ["Vehicle Type", "Fuel Type"]),
        ]
    )
    target_scaler = PowerTransformer(method="yeo-johnson")

    X_processed = preprocessor.fit_transform(X)
    y_scaled = target_scaler.fit_transform(y)
    return preprocessor, target_scaler, X_processed, y_scaled


def train_model(X_processed, y_scaled, n_features, *,
                lr=1e-3, patience=30, epochs=500, weight_decay=0.0,
                use_huber=False, dropout=0.0, use_compact=False):
    """Train a single model and return (model, best_val_loss, epoch_stopped)."""
    X_train, X_test, y_train, y_test = train_test_split(
        X_processed, y_scaled, test_size=0.2, random_state=42
    )

    X_train_t = torch.tensor(X_train, dtype=torch.float32)
    y_train_t = torch.tensor(y_train, dtype=torch.float32)
    X_test_t = torch.tensor(X_test, dtype=torch.float32)
    y_test_t = torch.tensor(y_test, dtype=torch.float32)

    train_ds = TensorDataset(X_train_t, y_train_t)
    train_loader = DataLoader(train_ds, batch_size=64, shuffle=True)

    if use_compact:
        model = CompactNet(n_features, dropout=dropout)
    else:
        model = ModifiedNet(n_features, dropout=dropout)

    optimizer = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=weight_decay)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        optimizer, patience=10, factor=0.5
    )
    criterion = nn.HuberLoss(delta=1.0) if use_huber else nn.MSELoss()

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
            # Duplicate multiplier-1 extra times (so total = multiplier×)
            for _ in range(multiplier - 1):
                extra_frames.append(subset.copy())

    if extra_frames:
        return pd.concat([df] + extra_frames, ignore_index=True)
    return df


# ── Feedback loop for one state+emission ────────────────────────────────────
def train_with_feedback(df_raw, target_col, emission_name, state, log_rows):
    """Train with up to MAX_FEEDBACK_ROUNDS of feedback.

    Returns the best checkpoint dict (same format as train_moves5.py).
    """
    features = ["Vehicle Type", "Fuel Type", "Age", "Speed"]

    # Base dataset: drop rows where target is zero or NaN
    df_base = df_raw[df_raw[target_col] > 0].copy()
    if len(df_base) < 100:
        print(f"  [SKIP] {state}/{emission_name}: only {len(df_base)} valid rows")
        return None

    best_checkpoint = None
    best_flagged_count = float("inf")
    best_round = -1

    for round_num in range(MAX_FEEDBACK_ROUNDS + 1):
        round_label = f"R{round_num}" if round_num > 0 else "initial"
        print(f"\n    --- {state}/{emission_name} [{round_label}] ---")

        # Determine training data and hyperparams for this round
        if round_num == 0:
            # Initial training: same as train_moves5.py
            df_train = df_base.copy()
            hp = {"lr": 1e-3, "patience": 30, "epochs": 500,
                  "weight_decay": 0.0, "use_huber": False, "dropout": 0.0,
                  "use_compact": False}
        elif round_num == 1:
            # Round 1: Upsample flagged combos
            print(f"    Upsampling {len(flagged)} flagged combos (4×)...")
            df_train = upsample_flagged_combos(df_base, target_col, flagged, multiplier=4)
            hp = {"lr": 1e-3, "patience": 30, "epochs": 500,
                  "weight_decay": 0.0, "use_huber": False, "dropout": 0.0,
                  "use_compact": False}
        elif round_num == 2:
            # Round 2: Hyperparameter adjustment + upsampling
            df_train = upsample_flagged_combos(df_base, target_col, flagged, multiplier=4)
            hp = {"lr": 5e-4, "patience": 50, "epochs": 500,
                  "weight_decay": 1e-4, "use_huber": True, "dropout": 0.0,
                  "use_compact": False}
            print(f"    Adjusted HP: lr=5e-4, patience=50, Huber loss, L2=1e-4")
        else:
            # Round 3: Architecture adjustment + upsampling
            df_train = upsample_flagged_combos(df_base, target_col, flagged, multiplier=4)
            hp = {"lr": 5e-4, "patience": 50, "epochs": 500,
                  "weight_decay": 1e-4, "use_huber": True, "dropout": 0.1,
                  "use_compact": True}
            print(f"    Using CompactNet with dropout=0.1")

        print(f"    Training on {len(df_train)} rows...")

        X = df_train[features].copy()
        y = df_train[[target_col]].values

        preprocessor, target_scaler, X_processed, y_scaled = \
            build_preprocessor_and_scale(X, y)
        n_features = X_processed.shape[1]

        model, val_loss, epochs_run = train_model(
            X_processed, y_scaled, n_features, **hp
        )

        # Compute overall test metrics (on base data, not upsampled)
        X_base = df_base[features].copy()
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
            "lr": hp["lr"],
            "patience": hp["patience"],
            "use_huber": hp["use_huber"],
            "dropout": hp["dropout"],
            "use_compact": hp["use_compact"],
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

        # If this is the last allowed round, stop
        if round_num >= MAX_FEEDBACK_ROUNDS:
            break

        # Print which combos are still flagged
        if flagged:
            print(f"    Flagged combos:")
            for f in flagged[:10]:  # Show first 10
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
    print("  AI FEEDBACK LOOP TRAINING")
    print("  Train models with automated validation and iterative improvement")
    print("=" * 70)

    log_rows = []
    summary_before = {}  # state/emission -> initial flagged count
    summary_after = {}   # state/emission -> final flagged count

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
