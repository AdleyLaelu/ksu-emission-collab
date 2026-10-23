"""
Plot raw MOVES5 data points (dots) vs neural network predictions (lines)
to visually validate model fit.

Generates one PNG per state per emission type (20 total).
Each chart shows multiple vehicle/fuel combos with dots = raw data, lines = model prediction.
"""

import os
import numpy as np
import pandas as pd
import torch
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from models import ModifiedNet

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "..", "Emission 1 corrected", "MOVES 5 Emission data")
OUTPUT_DIR = os.path.normpath(os.path.join(os.environ.get("TEMP", BASE_DIR), "model_validation_plots"))
FINAL_DIR = os.path.normpath(os.path.join(BASE_DIR, "..", "model_validation_plots"))

STATES = ["GA", "CA", "NY", "WA"]
STATE_FILES = {
    "GA": "Emissions_Output_GA.csv",
    "CA": "Emissions_Output_CA.csv",
    "NY": "Emissions_Output_NY.csv",
    "WA": "Emissions_Output_WA.csv",
}

VEHICLE_MAP = {
    11: "Motorcycle", 21: "Passenger Car", 31: "Passenger Truck",
    32: "Light Commercial Truck", 41: "Other Buses", 42: "Transit Bus",
    43: "School Bus", 51: "Refuse Truck", 52: "Single Unit Short-haul Truck",
    53: "Single Unit Long-haul Truck", 54: "Motorhome - Recreational Vehicle",
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
    "CO2": {"col": "CO2", "unit": "g/mi", "model_key": "CO2"},
    "Energy": {"col": "Total Energy", "unit": "KJ/mi", "model_key": "Energy"},
    "NOx": {"col": "NOx", "unit": "g/mi", "model_key": "NOx"},
    "PM2.5 Brake": {"col": "PM2.5 Brakewear", "unit": "g/mi", "model_key": "PM25Brake"},
    "PM2.5 Tire": {"col": "PM2.5 Tirewear", "unit": "g/mi", "model_key": "PM25Tire"},
}

# Top vehicle/fuel combos to plot (most common ones)
TOP_COMBOS = [
    ("Passenger Car", "Gasoline"),
    ("Passenger Car", "Electricity"),
    ("Passenger Truck", "Gasoline"),
    ("Passenger Truck", "Diesel Fuel"),
    ("Combination Long-haul Truck", "Diesel Fuel"),
    ("Transit Bus", "Diesel Fuel"),
    ("Single Unit Short-haul Truck", "Diesel Fuel"),
    ("Light Commercial Truck", "Gasoline"),
]

AGES = [5, 15, 30]

# Fuel consumption: convert Energy (KJ/mi) to fuel units
FUEL_CONSUMPTION = {
    "Gasoline": {"kj_per_unit": 120238.0, "unit": "gallon/mi", "label": "Gasoline"},
    "Diesel Fuel": {"kj_per_unit": 137381.0, "unit": "gallon/mi", "label": "Diesel"},
    "Ethanol (E-85)": {"kj_per_unit": 81800.0, "unit": "gallon/mi", "label": "Ethanol_E85"},
    "Compressed Natural Gas (CNG)": {"kj_per_unit": 120238.0, "unit": "GGE/mi", "label": "CNG"},
    "Electricity": {"kj_per_unit": 3600.0, "unit": "kWh/mi", "label": "Electricity"},
}

# Vehicle types to plot per fuel type
FUEL_VEHICLE_COMBOS = {
    "Gasoline": [
        "Passenger Car", "Passenger Truck", "Light Commercial Truck",
        "Motorcycle", "Single Unit Short-haul Truck", "Combination Short-haul Truck",
    ],
    "Diesel Fuel": [
        "Passenger Truck", "Combination Long-haul Truck", "Transit Bus",
        "Single Unit Short-haul Truck", "Single Unit Long-haul Truck", "School Bus",
    ],
    "Electricity": [
        "Passenger Car", "Passenger Truck", "Light Commercial Truck", "Transit Bus",
    ],
    "Ethanol (E-85)": [
        "Passenger Car", "Passenger Truck", "Light Commercial Truck",
    ],
    "Compressed Natural Gas (CNG)": [
        "Passenger Car", "Transit Bus", "Single Unit Short-haul Truck",
    ],
}

COLORS = [
    "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728",
    "#9467bd", "#8c564b", "#e377c2", "#7f7f7f",
]


def load_model(state, model_key):
    for model_dir in [os.path.join(BASE_DIR, "models", state),
                      os.path.join(BASE_DIR, "ml_models")]:
        path = os.path.join(model_dir, f"best_model_{state}{model_key}.pth")
        if os.path.exists(path):
            try:
                ckpt = torch.load(path, map_location="cpu", weights_only=False)
            except Exception:
                ckpt = torch.load(path, map_location="cpu")
            model = ModifiedNet(ckpt["input_features"])
            model.load_state_dict(ckpt["model_state_dict"])
            model.eval()
            return {
                "model": model,
                "preprocessor": ckpt["preprocessor"],
                "target_scaler": ckpt.get("target_scaler", ckpt.get("power_transformer")),
            }
    return None


def predict(model_info, vehicle_type, fuel_type, age, speeds):
    n = len(speeds)
    df = pd.DataFrame({
        "Vehicle Type": [vehicle_type] * n,
        "Fuel Type": [fuel_type] * n,
        "Age": [age] * n,
        "Speed": speeds,
    })
    preprocessor = model_info["preprocessor"]
    processed = preprocessor.transform(df)
    if hasattr(processed, "toarray"):
        tensor = torch.tensor(processed.toarray(), dtype=torch.float32)
    else:
        tensor = torch.tensor(processed, dtype=torch.float32)

    with torch.no_grad():
        raw = model_info["model"](tensor)
        result = model_info["target_scaler"].inverse_transform(raw.numpy())
    return np.maximum(result.flatten(), 0)


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    for state in STATES:
        print(f"\n{'='*60}")
        print(f"Plotting {state}")
        print(f"{'='*60}")

        # Load raw data
        csv_path = os.path.join(DATA_DIR, STATE_FILES[state])
        if not os.path.exists(csv_path):
            print(f"  Data file not found: {csv_path}")
            continue

        raw_df = pd.read_csv(csv_path)
        raw_df["Vehicle Type"] = raw_df["VehicleID"].map(VEHICLE_MAP)
        raw_df["Fuel Type"] = raw_df["fuelTypeID"].map(FUEL_MAP)
        raw_df["Speed_mph"] = raw_df["speed"].map(SPEED_MAP)

        # Load models
        models = {}
        for em_name, em_info in EMISSION_TARGETS.items():
            m = load_model(state, em_info["model_key"])
            if m:
                models[em_name] = m
                print(f"  Loaded {em_name} model")

        # Smooth speed range for predictions
        pred_speeds = np.linspace(2.5, 75, 100)

        # Plot each emission type for each age
        for age in AGES:
            for em_name, em_info in EMISSION_TARGETS.items():
                if em_name not in models:
                    continue

                fig, ax = plt.subplots(figsize=(12, 7))
                combo_count = 0

                for i, (vtype, ftype) in enumerate(TOP_COMBOS):
                    # Filter raw data for this combo and age
                    mask = (
                        (raw_df["Vehicle Type"] == vtype) &
                        (raw_df["Fuel Type"] == ftype) &
                        (raw_df["age"] == age)
                    )
                    subset = raw_df[mask]

                    if len(subset) == 0:
                        continue

                    # Skip Electricity for CO2 and NOx
                    if ftype == "Electricity" and em_name in ["CO2", "NOx"]:
                        continue

                    color = COLORS[combo_count % len(COLORS)]
                    label = f"{vtype} - {ftype}"

                    # Plot raw data as dots
                    ax.scatter(
                        subset["Speed_mph"], subset[em_info["col"]],
                        color=color, alpha=0.6, s=40, zorder=3,
                        label=f"{label} (MOVES data)"
                    )

                    # Plot model prediction as smooth line
                    try:
                        pred_vals = predict(models[em_name], vtype, ftype, age, pred_speeds.tolist())
                        ax.plot(
                            pred_speeds, pred_vals,
                            color=color, linewidth=2, zorder=2,
                            label=f"{label} (NN prediction)"
                        )
                    except Exception as e:
                        print(f"    Prediction failed for {vtype}/{ftype}/{em_name}/age{age}: {e}")

                    combo_count += 1

                ax.set_xlabel("Speed (mph)", fontsize=12)
                ax.set_ylabel(f"{em_name} ({em_info['unit']})", fontsize=12)
                ax.set_title(f"{state} - {em_name}: MOVES5 Data vs Neural Network Predictions (Age={age})", fontsize=13)
                ax.legend(fontsize=7, loc="upper right", ncol=2)
                ax.grid(True, alpha=0.3)
                ax.set_xlim(0, 80)

                fname = f"{state}_{em_name.replace('.', '').replace(' ', '_')}_age{age}.png"
                fig.tight_layout()
                fig.savefig(os.path.join(OUTPUT_DIR, fname), dpi=150)
                plt.close(fig)
                print(f"  Saved {fname}")

        # Plot fuel consumption per fuel type for each age
        if "Energy" not in models:
            continue

        for age in AGES:
            for ftype, fuel_info in FUEL_CONSUMPTION.items():
                kj_per_unit = fuel_info["kj_per_unit"]
                fuel_unit = fuel_info["unit"]
                fuel_label = fuel_info["label"]

                vtypes = FUEL_VEHICLE_COMBOS.get(ftype, [])
                if not vtypes:
                    continue

                fig, ax = plt.subplots(figsize=(12, 7))
                combo_count = 0

                for vtype in vtypes:
                    # Filter raw data
                    mask = (
                        (raw_df["Vehicle Type"] == vtype) &
                        (raw_df["Fuel Type"] == ftype) &
                        (raw_df["age"] == age)
                    )
                    subset = raw_df[mask]

                    if len(subset) == 0:
                        continue

                    color = COLORS[combo_count % len(COLORS)]

                    # Convert raw Energy (KJ/mi) to fuel units
                    raw_fuel = subset["Total Energy"].values / kj_per_unit
                    ax.scatter(
                        subset["Speed_mph"], raw_fuel,
                        color=color, alpha=0.6, s=40, zorder=3,
                        label=f"{vtype} (MOVES data)"
                    )

                    # Predict and convert
                    try:
                        energy_pred = predict(models["Energy"], vtype, ftype, age, pred_speeds.tolist())
                        fuel_pred = energy_pred / kj_per_unit
                        ax.plot(
                            pred_speeds, fuel_pred,
                            color=color, linewidth=2, zorder=2,
                            label=f"{vtype} (NN prediction)"
                        )
                    except Exception as e:
                        print(f"    Prediction failed for {vtype}/{ftype}/fuel/age{age}: {e}")

                    combo_count += 1

                if combo_count == 0:
                    plt.close(fig)
                    continue

                ax.set_xlabel("Speed (mph)", fontsize=12)
                ax.set_ylabel(f"{fuel_label} ({fuel_unit})", fontsize=12)
                ax.set_title(f"{state} - {fuel_label} Consumption: MOVES5 Data vs NN Predictions (Age={age})", fontsize=13)
                ax.legend(fontsize=8, loc="upper right")
                ax.grid(True, alpha=0.3)
                ax.set_xlim(0, 80)

                fname = f"{state}_Fuel_{fuel_label}_age{age}.png"
                fig.tight_layout()
                fig.savefig(os.path.join(OUTPUT_DIR, fname), dpi=150)
                plt.close(fig)
                print(f"  Saved {fname}")

    # Copy from temp to final location
    import shutil
    if os.path.exists(FINAL_DIR):
        shutil.rmtree(FINAL_DIR, ignore_errors=True)
    shutil.copytree(OUTPUT_DIR, FINAL_DIR)
    print(f"\nAll plots saved to: {FINAL_DIR}")


if __name__ == "__main__":
    main()
