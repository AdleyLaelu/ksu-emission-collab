"""
Comprehensive model validation: exhaustive analysis of ALL vehicle/fuel/age
combinations across all 4 states.

Outputs:
  - validation_summary.csv   (per-combo error metrics)
  - validation_report.txt    (flagged problems grouped by category)
  - model_validation_plots/comprehensive/  (one plot per vehicle/fuel/emission)

Usage:
    cd backend && python comprehensive_validation.py
"""

import os
import sys
import warnings
import numpy as np
import pandas as pd
import torch
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error

from sklearn.base import BaseEstimator, TransformerMixin
from models import ModifiedNet

warnings.filterwarnings("ignore")

# LogScaler must be defined here so torch.load can unpickle model checkpoints that use it
class LogScaler(BaseEstimator, TransformerMixin):
    def fit(self, X, y=None):
        self._fitted = True
        return self
    def transform(self, X):
        return np.log1p(np.maximum(X, 0))
    def inverse_transform(self, X):
        return np.expm1(X)

# ── Paths ────────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "..", "Emission 1 corrected", "MOVES 5 Emission data")
PLOT_DIR = os.path.normpath(os.path.join(BASE_DIR, "..", "model_validation_plots", "comprehensive"))
SUMMARY_CSV = os.path.join(BASE_DIR, "validation_summary.csv")
REPORT_TXT = os.path.join(BASE_DIR, "validation_report.txt")

STATES = ["GA"]

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

SPEED_MAP = {
    1: 2.5, 2: 5, 3: 10, 4: 15, 5: 20, 6: 25, 7: 30, 8: 35,
    9: 40, 10: 45, 11: 50, 12: 55, 13: 60, 14: 65, 15: 70, 16: 75,
}

EMISSION_TARGETS = {
    "CO2":       {"col": "CO2",              "unit": "g/mi",  "model_key": "CO2"},
    "Energy":    {"col": "Total Energy",     "unit": "KJ/mi", "model_key": "Energy"},
    "NOx":       {"col": "NOx",              "unit": "g/mi",  "model_key": "NOx"},
    "PM25Brake": {"col": "PM2.5 Brakewear",  "unit": "g/mi",  "model_key": "PM25Brake"},
    "PM25Tire":  {"col": "PM2.5 Tirewear",   "unit": "g/mi",  "model_key": "PM25Tire"},
}

# Representative ages to overlay on plots
PLOT_AGES = [5, 15, 30]
AGE_COLORS = {5: "#1f77b4", 15: "#ff7f0e", 30: "#2ca02c"}


# ── Model helpers (reused from plot_model_vs_data.py) ────────────────────────

def load_model(state, model_key):
    for model_dir in [os.path.join(BASE_DIR, "models", state),
                      os.path.join(BASE_DIR, "ml_models")]:
        path = os.path.join(model_dir, f"best_model_{state}{model_key}.pth")
        if os.path.exists(path):
            try:
                ckpt = torch.load(path, map_location="cpu", weights_only=False)
            except Exception:
                ckpt = torch.load(path, map_location="cpu", weights_only=False)
            model = ModifiedNet(ckpt["input_features"])
            model.load_state_dict(ckpt["model_state_dict"])
            model.eval()
            return {
                "model": model,
                "preprocessor": ckpt["preprocessor"],
                "target_scaler": ckpt.get("target_scaler", ckpt.get("power_transformer")),
            }
    return None


def add_age_bin(df):
    bins = pd.cut(df["Age"], bins=[-1, 2, 25, 100], labels=["young", "mid", "old"])
    df = df.copy()
    df["Age_Bin"] = bins.astype(str)
    return df

def predict(model_info, vehicle_type, fuel_type, age, speeds):
    n = len(speeds)
    df = pd.DataFrame({
        "Vehicle Type": [vehicle_type] * n,
        "Fuel Type": [fuel_type] * n,
        "Age": [age] * n,
        "Speed": speeds,
    })
    df = add_age_bin(df)
    processed = model_info["preprocessor"].transform(df)
    if hasattr(processed, "toarray"):
        tensor = torch.tensor(processed.toarray(), dtype=torch.float32)
    else:
        tensor = torch.tensor(processed, dtype=torch.float32)

    with torch.no_grad():
        raw = model_info["model"](tensor)
        result = model_info["target_scaler"].inverse_transform(raw.numpy())
    return np.maximum(result.flatten(), 0)


# ── Step 1: Per-combo error metrics ─────────────────────────────────────────

def compute_metrics(y_true, y_pred):
    """Return dict of R2, RMSE, MAE, MAPE and flags."""
    # Filter out NaN/Inf in either array
    valid = np.isfinite(y_true) & np.isfinite(y_pred)
    y_true = y_true[valid]
    y_pred = y_pred[valid]

    n = len(y_true)
    if n < 2:
        return {"R2": np.nan, "RMSE": np.nan, "MAE": np.nan, "MAPE": np.nan, "flag": "too_few_rows"}

    # Check for all-zero predictions
    if np.allclose(y_pred, 0):
        return {"R2": np.nan, "RMSE": np.nan, "MAE": np.nan, "MAPE": np.nan, "flag": "zero_output"}

    # Check for constant predictions
    if np.std(y_pred) < 1e-10:
        return {"R2": np.nan, "RMSE": np.nan, "MAE": np.nan, "MAPE": np.nan, "flag": "constant_output"}

    r2 = r2_score(y_true, y_pred)
    rmse = np.sqrt(mean_squared_error(y_true, y_pred))
    mae = mean_absolute_error(y_true, y_pred)

    # MAPE — skip near-zero true values
    mask = np.abs(y_true) > 1e-8
    if mask.sum() > 0:
        mape = np.mean(np.abs((y_true[mask] - y_pred[mask]) / y_true[mask])) * 100
    else:
        mape = np.nan

    # Flag logic with near-zero and low-variance relaxation
    flag = ""
    mean_actual = np.mean(np.abs(y_true))
    near_zero = mean_actual < 0.1  # values under 0.1 g/mi
    cv = np.std(y_true) / (mean_actual + 1e-12)
    low_variance = cv < 0.15  # nearly flat curve

    # Near-zero values: skip all flagging — absolute error is negligible
    if near_zero:
        flag = ""
    elif low_variance and not np.isnan(mape) and mape < 10:
        flag = ""  # nearly flat curve with low MAPE — R² meaningless
    elif not np.isnan(mape) and mape > 100:
        flag = "wildly_off"
    elif not np.isnan(mape) and mape > 50:
        flag = "high_error"
    elif r2 < 0.5:
        flag = "low_R2"

    return {"R2": r2, "RMSE": rmse, "MAE": mae, "MAPE": mape, "flag": flag}


def run_step1(states_data, models_by_state):
    """Compute per-combo error metrics for every vehicle/fuel/age/emission."""
    rows = []

    for state, raw_df in states_data.items():
        state_models = models_by_state[state]
        combos = raw_df.groupby(["Vehicle Type", "Fuel Type"]).size().reset_index(name="total_rows")

        for _, combo_row in combos.iterrows():
            vtype = combo_row["Vehicle Type"]
            ftype = combo_row["Fuel Type"]

            ages = sorted(raw_df.loc[
                (raw_df["Vehicle Type"] == vtype) & (raw_df["Fuel Type"] == ftype),
                "Age"
            ].unique())

            for age in ages:
                mask = (
                    (raw_df["Vehicle Type"] == vtype) &
                    (raw_df["Fuel Type"] == ftype) &
                    (raw_df["Age"] == age)
                )
                subset = raw_df[mask]
                speeds = subset["Speed_mph"].values.tolist()

                for em_name, em_info in EMISSION_TARGETS.items():
                    if em_name not in state_models:
                        rows.append({
                            "state": state, "vehicle_type": vtype, "fuel_type": ftype,
                            "age": age, "emission": em_name, "n_rows": len(subset),
                            "R2": np.nan, "RMSE": np.nan, "MAE": np.nan, "MAPE": np.nan,
                            "flag": "model_missing",
                        })
                        continue

                    y_true = subset[em_info["col"]].values

                    # Skip if all true values are zero (nothing to predict)
                    if np.allclose(y_true, 0):
                        rows.append({
                            "state": state, "vehicle_type": vtype, "fuel_type": ftype,
                            "age": age, "emission": em_name, "n_rows": len(subset),
                            "R2": np.nan, "RMSE": np.nan, "MAE": np.nan, "MAPE": np.nan,
                            "flag": "true_all_zero",
                        })
                        continue

                    try:
                        y_pred = predict(state_models[em_name], vtype, ftype, age, speeds)
                    except Exception as e:
                        rows.append({
                            "state": state, "vehicle_type": vtype, "fuel_type": ftype,
                            "age": age, "emission": em_name, "n_rows": len(subset),
                            "R2": np.nan, "RMSE": np.nan, "MAE": np.nan, "MAPE": np.nan,
                            "flag": f"predict_error: {e}",
                        })
                        continue

                    metrics = compute_metrics(y_true, y_pred)
                    rows.append({
                        "state": state, "vehicle_type": vtype, "fuel_type": ftype,
                        "age": age, "emission": em_name, "n_rows": len(subset),
                        **metrics,
                    })

        print(f"  {state}: processed {len(combos)} vehicle/fuel combos")

    summary_df = pd.DataFrame(rows)
    summary_df.to_csv(SUMMARY_CSV, index=False)
    print(f"\nSaved {SUMMARY_CSV} ({len(summary_df)} rows)")
    return summary_df


# ── Step 2: Aggregated report ───────────────────────────────────────────────

def run_step2(summary_df):
    """Generate a human-readable report of flagged problems."""
    lines = []
    lines.append("=" * 80)
    lines.append("COMPREHENSIVE MODEL VALIDATION REPORT")
    lines.append("=" * 80)
    lines.append("")

    # Overall stats
    total = len(summary_df)
    flagged = summary_df[summary_df["flag"] != ""]
    ok = summary_df[summary_df["flag"] == ""]
    lines.append(f"Total combo/age/emission evaluations: {total}")
    lines.append(f"  OK (no flag):  {len(ok)}")
    lines.append(f"  Flagged:       {len(flagged)}")
    lines.append("")

    # Group by flag type
    categories = {
        "model_missing":   "MODEL MISSING — no .pth file found",
        "predict_error":   "PREDICTION ERROR — model crashed during inference",
        "zero_output":     "ZERO OUTPUT — model predicts all zeros",
        "constant_output": "CONSTANT OUTPUT — model predicts identical values for all speeds",
        "true_all_zero":   "TRUE ALL ZERO — ground truth is all zeros (expected for some combos)",
        "too_few_rows":    "TOO FEW ROWS — fewer than 2 data points",
        "wildly_off":      "WILDLY OFF — MAPE > 100%",
        "high_error":      "HIGH ERROR — MAPE > 50%",
        "low_R2":          "LOW R² — R² < 0.5",
    }

    for flag_key, description in categories.items():
        if flag_key == "predict_error":
            subset = flagged[flagged["flag"].str.startswith("predict_error")]
        else:
            subset = flagged[flagged["flag"] == flag_key]

        if len(subset) == 0:
            continue

        lines.append("-" * 80)
        lines.append(f"{description}  ({len(subset)} cases)")
        lines.append("-" * 80)

        # Group by state/vehicle/fuel for readability
        for state in STATES:
            state_subset = subset[subset["state"] == state]
            if len(state_subset) == 0:
                continue
            lines.append(f"\n  [{state}]")
            for _, row in state_subset.iterrows():
                age_str = f"age={int(row['age']):2d}"
                em_str = row["emission"]
                r2_str = f"R²={row['R2']:.3f}" if pd.notna(row["R2"]) else "R²=N/A"
                mape_str = f"MAPE={row['MAPE']:.1f}%" if pd.notna(row["MAPE"]) else "MAPE=N/A"
                lines.append(
                    f"    {row['vehicle_type']:35s} | {row['fuel_type']:30s} | "
                    f"{age_str} | {em_str:10s} | n={int(row['n_rows']):3d} | {r2_str} | {mape_str}"
                )
        lines.append("")

    # Per-state summary table
    lines.append("=" * 80)
    lines.append("PER-STATE SUMMARY")
    lines.append("=" * 80)
    for state in STATES:
        state_df = summary_df[summary_df["state"] == state]
        n_combos = state_df.groupby(["vehicle_type", "fuel_type"]).ngroups
        n_ok = len(state_df[state_df["flag"] == ""])
        n_flagged = len(state_df[state_df["flag"] != ""])
        # Median R² and MAPE for non-flagged rows
        ok_df = state_df[(state_df["flag"] == "") & state_df["R2"].notna()]
        med_r2 = ok_df["R2"].median() if len(ok_df) > 0 else np.nan
        med_mape = ok_df["MAPE"].median() if len(ok_df) > 0 else np.nan
        lines.append(
            f"  {state}: {n_combos} vehicle/fuel combos, {n_ok} OK, {n_flagged} flagged, "
            f"median R²={med_r2:.3f}, median MAPE={med_mape:.1f}%"
        )
    lines.append("")

    report = "\n".join(lines)
    with open(REPORT_TXT, "w") as f:
        f.write(report)
    print(f"Saved {REPORT_TXT}")
    # Also print to console
    print(report)


# ── Step 3: Comprehensive plots ─────────────────────────────────────────────

def run_step3(states_data, models_by_state):
    """Generate one plot per vehicle/fuel/emission/state, overlaying ages."""
    os.makedirs(PLOT_DIR, exist_ok=True)
    plot_count = 0
    pred_speeds = np.linspace(2.5, 75, 100)

    for state, raw_df in states_data.items():
        state_models = models_by_state[state]
        combos = raw_df.groupby(["Vehicle Type", "Fuel Type"]).size().reset_index(name="count")

        for _, combo_row in combos.iterrows():
            vtype = combo_row["Vehicle Type"]
            ftype = combo_row["Fuel Type"]

            for em_name, em_info in EMISSION_TARGETS.items():
                if em_name not in state_models:
                    continue

                # Check which ages exist in data for this combo
                combo_mask = (raw_df["Vehicle Type"] == vtype) & (raw_df["Fuel Type"] == ftype)
                available_ages = sorted(raw_df.loc[combo_mask, "Age"].unique())

                # Select ages to plot: use PLOT_AGES if available, otherwise pick up to 3
                ages_to_plot = [a for a in PLOT_AGES if a in available_ages]
                if not ages_to_plot:
                    # Pick min, median, max age
                    if len(available_ages) >= 3:
                        ages_to_plot = [
                            available_ages[0],
                            available_ages[len(available_ages) // 2],
                            available_ages[-1],
                        ]
                    else:
                        ages_to_plot = available_ages

                if not ages_to_plot:
                    continue

                fig, ax = plt.subplots(figsize=(10, 6))
                has_data = False

                # Assign colors to ages
                age_color_map = {}
                default_colors = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd"]
                for i, age in enumerate(ages_to_plot):
                    age_color_map[age] = AGE_COLORS.get(age, default_colors[i % len(default_colors)])

                for age in ages_to_plot:
                    mask = combo_mask & (raw_df["Age"] == age)
                    subset = raw_df[mask]
                    if len(subset) == 0:
                        continue

                    color = age_color_map[age]
                    y_true = subset[em_info["col"]].values

                    # Plot MOVES data points
                    ax.scatter(
                        subset["Speed_mph"], y_true,
                        color=color, alpha=0.6, s=30, zorder=3,
                        label=f"MOVES age={age}"
                    )

                    # Plot model prediction line
                    try:
                        y_pred = predict(state_models[em_name], vtype, ftype, age,
                                         pred_speeds.tolist())
                        ax.plot(
                            pred_speeds, y_pred,
                            color=color, linewidth=2, zorder=2, linestyle="--",
                            label=f"FNN age={age}"
                        )
                        has_data = True
                    except Exception:
                        pass

                if not has_data:
                    plt.close(fig)
                    continue

                # Clean up vehicle/fuel names for filename (keep short for Windows path limits)
                vtype_clean = vtype.replace(" ", "_").replace("-", "_")
                ftype_clean = ftype.replace(" ", "_").replace("(", "").replace(")", "").replace("-", "_")
                # Shorten common long names
                vtype_clean = (vtype_clean
                    .replace("Combination_Short_haul_Truck", "CombSHT")
                    .replace("Combination_Long_haul_Truck", "CombLHT")
                    .replace("Single_Unit_Short_haul_Truck", "SUSHT")
                    .replace("Single_Unit_Long_haul_Truck", "SULHT")
                    .replace("Light_Commercial_Truck", "LCT")
                    .replace("Passenger_Car", "PassCar")
                    .replace("Passenger_Truck", "PassTruck")
                    .replace("Compressed_Natural_Gas_CNG", "CNG")
                    .replace("Motor_Home", "MotorHome"))
                ftype_clean = ftype_clean.replace("Compressed_Natural_Gas_CNG", "CNG").replace("Ethanol_E_85", "E85").replace("Diesel_Fuel", "Diesel")

                ax.set_xlabel("Speed (mph)", fontsize=11)
                ax.set_ylabel(f"{em_name} ({em_info['unit']})", fontsize=11)
                ax.set_title(f"{state} | {vtype} | {ftype} | {em_name}", fontsize=12)
                ax.legend(fontsize=8, loc="best")
                ax.grid(True, alpha=0.3)
                ax.set_xlim(2.5, 80)

                fname = f"{state}_{vtype_clean}_{ftype_clean}_{em_name}.png"
                fig.tight_layout()
                fig.savefig(os.path.join(PLOT_DIR, fname), dpi=120)
                plt.close(fig)
                plot_count += 1

        print(f"  {state}: generated plots")

    print(f"\nSaved {plot_count} plots to {PLOT_DIR}")


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("COMPREHENSIVE MODEL VALIDATION")
    print("=" * 60)

    # Load data and models for all states
    states_data = {}
    models_by_state = {}

    for state in STATES:
        csv_path = os.path.join(DATA_DIR, f"Emissions_Output_{state}.csv")
        if not os.path.exists(csv_path):
            print(f"  WARNING: {csv_path} not found, skipping {state}")
            continue

        raw_df = pd.read_csv(csv_path)
        raw_df["Vehicle Type"] = raw_df["VehicleID"].map(VEHICLE_MAP)
        raw_df["Fuel Type"] = raw_df["fuelTypeID"].map(FUEL_MAP)
        raw_df["Speed_mph"] = raw_df["speed"].map(SPEED_MAP)
        raw_df["Age"] = raw_df["age"]

        # Drop rows with unmapped values
        raw_df = raw_df.dropna(subset=["Vehicle Type", "Fuel Type", "Speed_mph"])

        n_combos = raw_df.groupby(["Vehicle Type", "Fuel Type"]).ngroups
        n_ages = raw_df["Age"].nunique()
        print(f"  {state}: {len(raw_df)} rows, {n_combos} vehicle/fuel combos, {n_ages} ages")
        states_data[state] = raw_df

        # Load models
        state_models = {}
        for em_name, em_info in EMISSION_TARGETS.items():
            m = load_model(state, em_info["model_key"])
            if m:
                state_models[em_name] = m
        print(f"    Loaded {len(state_models)}/5 models")
        models_by_state[state] = state_models

    if not states_data:
        print("No data files found. Exiting.")
        sys.exit(1)

    # Step 1
    print(f"\n{'-'*60}")
    print("STEP 1: Computing per-combo error metrics...")
    print(f"{'-'*60}")
    summary_df = run_step1(states_data, models_by_state)

    # Step 2
    print(f"\n{'-'*60}")
    print("STEP 2: Generating validation report...")
    print(f"{'-'*60}")
    run_step2(summary_df)

    # Step 3
    print(f"\n{'-'*60}")
    print("STEP 3: Generating comprehensive plots...")
    print(f"{'-'*60}")
    run_step3(states_data, models_by_state)

    print(f"\n{'='*60}")
    print("DONE. Review:")
    print(f"  - {SUMMARY_CSV}")
    print(f"  - {REPORT_TXT}")
    print(f"  - {PLOT_DIR}/")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
