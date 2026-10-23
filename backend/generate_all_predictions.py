"""
Pre-generate ALL energy consumption and emission predictions for every
combination of (state, fuel, vehicle, age, speed) so the frontend can
load them instantly instead of making hundreds of API calls.

Usage:
    cd backend
    python generate_all_predictions.py

Produces one JSON file per state in ../frontend/public/pregenerated/{STATE}.json
"""

import os
import sys
import json
import time
import warnings
import numpy as np
import pandas as pd
import torch
from scipy.signal import savgol_filter

# Suppress sklearn NaN warnings (expected for some inverse transforms)
warnings.filterwarnings("ignore", category=UserWarning, module="sklearn")

# Make imports work when running from the backend directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from models import ModifiedNet
from sklearn.base import BaseEstimator, TransformerMixin

# LogScaler must be defined here so torch.load can unpickle model checkpoints that use it
class LogScaler(BaseEstimator, TransformerMixin):
    def fit(self, X, y=None):
        self._fitted = True
        return self
    def transform(self, X):
        return np.log1p(np.maximum(X, 0))
    def inverse_transform(self, X):
        return np.expm1(X)

def add_age_bin(df):
    bins = pd.cut(df["Age"], bins=[-1, 2, 25, 100], labels=["young", "mid", "old"])
    df = df.copy()
    df["Age_Bin"] = bins.astype(str)
    return df

# ── Constants (must match run.py and frontend) ──────────────────────────

STATES = ["GA", "CA", "NY", "WA"]

VEHICLE_TYPES = [
    "Combination Long-haul Truck",
    "Combination Short-haul Truck",
    "Light Commercial Truck",
    "Motorhome - Recreational Vehicle",
    "Motorcycle",
    "Other Buses",
    "Passenger Car",
    "Passenger Truck",
    "Refuse Truck",
    "School Bus",
    "Single Unit Long-haul Truck",
    "Single Unit Short-haul Truck",
    "Transit Bus",
]

FUEL_TYPES = [
    "Compressed Natural Gas - CNG",
    "Diesel Fuel",
    "Electricity",
    "Ethanol - E-85",
    "Gasoline",
]

EMISSION_TYPES = {
    "CO2 Emissions":    ("Co2",          "g/mile"),
    "Energy Rate":      ("TotalEnergyRate", "kWh/100km"),
    "NOx":              ("NOx",          "g/mile"),
    "PM2.5 Brake Wear": ("PM25BrakeWear", "g/mile"),
    "PM2.5 Tire Wear":  ("PM25TireWear",  "g/mile"),
}

# Electricity doesn't produce CO2 or NOx
ELECTRICITY_EXCLUDED = {"CO2 Emissions", "NOx"}

# Map frontend display names → model-trained category names
FUEL_NAME_TO_MODEL = {
    "Compressed Natural Gas - CNG": "Compressed Natural Gas (CNG)",
    "Ethanol - E-85": "Ethanol (E-85)",
    "Diesel Fuel": "Diesel Fuel",
    "Electricity": "Electricity",
    "Gasoline": "Gasoline",
}

VEHICLE_NAME_TO_MODEL = {
    "Motorhome - Recreational Vehicle": "Motor Home",
}

# CO2 and NOx models were trained WITHOUT Electricity as a fuel category
MODELS_WITHOUT_ELECTRICITY = {"Co2", "NOx"}

# MOVES-standard Lower Heating Values (LHV) for fuel energy content.
# Source: EPA MOVES Technical Report EPA-420-R-21-006, Table 4-1.
# Using LHV because MOVES "Total Energy" output is LHV-based.
KJ_PER_UNIT = {
    "Gasoline": 120238.0,
    "Diesel Fuel": 137381.0,
    "Ethanol - E-85": 81800.0,
    "Compressed Natural Gas - CNG": 120238.0,  # 1 GGE = 1 gallon gasoline energy
    "Electricity": 3600.0,                      # 1 kWh = 3600 kJ (exact)
}

UNIT_TYPE = {
    "Gasoline": "gallon/mile",
    "Diesel Fuel": "gallon/mile",
    "Ethanol - E-85": "gallon/mile",
    "Compressed Natural Gas - CNG": "GGE/mile",
    "Electricity": "kWh/mile",
}

AGES = list(range(0, 41))   # 0-40
SPEEDS = list(range(0, 71)) # 0-70

FEATURE_MAP = {
    "CO2": 19, "Energy": 20, "NOx": 19, "PM25Brake": 20, "PM25Tire": 20,
}

MODEL_FILE_SUFFIX = {
    "Co2": "CO2",
    "TotalEnergyRate": "Energy",
    "NOx": "NOx",
    "PM25BrakeWear": "PM25Brake",
    "PM25TireWear": "PM25Tire",
}


# ── Model loading ───────────────────────────────────────────────────────

def load_model(file_path, input_features):
    """Load a single .pth model checkpoint."""
    sys.modules["__main__"].ModifiedNet = ModifiedNet
    sys.modules["__main__"].LogScaler = LogScaler
    try:
        checkpoint = torch.load(file_path, map_location="cpu", weights_only=False)
    except Exception:
        checkpoint = torch.load(file_path, map_location="cpu")

    # Use input_features from checkpoint if available (handles Age_Bin addition)
    n_features = checkpoint.get("input_features", input_features)
    model = ModifiedNet(n_features)
    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()

    return {
        "model": model,
        "preprocessor": checkpoint["preprocessor"],
        "target_scaler": checkpoint.get("target_scaler", checkpoint.get("power_transformer", None)),
    }


def load_state_models(state):
    """Load all 5 models for a given state."""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    state_path = os.path.join(base_dir, "models", state)

    result = {}
    for suffix, file_suffix in MODEL_FILE_SUFFIX.items():
        model_key = f"{state.lower()}{suffix}"
        pth_file = os.path.join(state_path, f"best_model_{state}{file_suffix}.pth")
        n_features = FEATURE_MAP[file_suffix]
        result[model_key] = load_model(pth_file, input_features=n_features)
        print(f"  Loaded {model_key}")

    return result


# ── Post-processing: smooth predictions ─────────────────────────────────

def smooth_predictions(values):
    """Apply heavy smoothing to produce clean, publication-quality curves.

    Uses two passes: a wide Savitzky-Golay filter followed by a Gaussian
    kernel to eliminate all per-speed-bin noise from the neural network.
    """
    from scipy.ndimage import gaussian_filter1d

    # Replace None with NaN for processing
    arr = np.array([v if v is not None else np.nan for v in values], dtype=float)

    valid_mask = np.isfinite(arr)
    n_valid = valid_mask.sum()
    if n_valid < 7:
        return values

    # Interpolate NaN gaps before smoothing
    arr_filled = arr.copy()
    if np.any(~valid_mask):
        valid_idx = np.where(valid_mask)[0]
        arr_filled[~valid_mask] = np.interp(
            np.where(~valid_mask)[0], valid_idx, arr[valid_mask]
        )

    # Pass 1: Wide Savitzky-Golay (window=21, polyorder=2)
    # Covers ~20 mph range, low poly order forces smooth fit
    window = min(21, n_valid if n_valid % 2 == 1 else n_valid - 1)
    if window >= 5:
        arr_filled = savgol_filter(arr_filled, window_length=window, polyorder=2)

    # Pass 2: Gaussian blur (sigma=3) to remove any remaining wiggles
    arr_filled = gaussian_filter1d(arr_filled, sigma=3)

    # Ensure non-negative
    arr_filled = np.maximum(arr_filled, 0)

    # Restore original None positions
    result = []
    for i, v in enumerate(values):
        if v is None:
            result.append(None)
        else:
            result.append(round(float(arr_filled[i]), 8))
    return result


# ── Batched prediction — all speeds at once ─────────────────────────────

def predict_batch(model_key, models, model_vehicle, model_fuel, state, age):
    """
    Predict for all 71 speeds at once for a given (vehicle, fuel, age).
    Returns a list of 71 float values.
    """
    model_info = models[model_key]
    model = model_info["model"]
    preprocessor = model_info["preprocessor"]
    target_scaler = model_info["target_scaler"]

    # Build a DataFrame with one row per speed
    rows = []
    for speed in SPEEDS:
        rows.append({
            "Age": age,
            "Speed": speed,
            "Vehicle Type": model_vehicle,
            "Fuel Type": model_fuel,
            "State": state,
        })
    df = pd.DataFrame(rows)
    df = add_age_bin(df)

    processed = preprocessor.transform(df)
    if hasattr(processed, "toarray"):
        tensor = torch.tensor(processed.toarray(), dtype=torch.float32)
    else:
        tensor = torch.tensor(processed, dtype=torch.float32)

    with torch.no_grad():
        raw = model(tensor)
        preds = target_scaler.inverse_transform(raw.numpy())

    import math
    values = [None if math.isnan(p[0]) else float(p[0]) for p in preds]
    return smooth_predictions(values)


# ── Main generation ─────────────────────────────────────────────────────

def generate_state(state, state_models):
    """Generate all predictions for one state. Returns a dict."""
    output = {"consumption": {}, "emissions": {}}
    energy_key = f"{state.lower()}TotalEnergyRate"

    total_combos = len(FUEL_TYPES) * len(VEHICLE_TYPES)
    done = 0

    for fuel in FUEL_TYPES:
        kj_per_unit = KJ_PER_UNIT[fuel]
        fuel_unit = UNIT_TYPE[fuel]
        model_fuel = FUEL_NAME_TO_MODEL.get(fuel, fuel)

        for vehicle in VEHICLE_TYPES:
            done += 1
            model_vehicle = VEHICLE_NAME_TO_MODEL.get(vehicle, vehicle)
            print(f"  [{state}] {done}/{total_combos}  {fuel} | {vehicle}", flush=True)

            # ── Consumption (all ages × all speeds) ──
            cons_key = f"{fuel}|{vehicle}"
            cons_ages = {}

            for age in AGES:
                preds = predict_batch(energy_key, state_models, model_vehicle, model_fuel, state, age)
                # Model output is kJ/mile; divide by kJ/unit to get fuel_unit/mile
                values = [None if p is None else round(p / kj_per_unit, 8) for p in preds]
                cons_ages[str(age)] = values

            output["consumption"][cons_key] = {
                "unit": fuel_unit,
                "ages": cons_ages,
            }

            # ── Emissions (all applicable types × all ages × all speeds) ──
            for em_label, (em_suffix, em_unit) in EMISSION_TYPES.items():
                if em_label == "Energy Rate":
                    continue
                if fuel == "Electricity" and em_label in ELECTRICITY_EXCLUDED:
                    continue
                if em_suffix in MODELS_WITHOUT_ELECTRICITY and fuel == "Electricity":
                    continue

                em_key_json = f"{fuel}|{em_label}|{vehicle}"
                model_key = f"{state.lower()}{em_suffix}"
                em_ages = {}

                for age in AGES:
                    preds = predict_batch(model_key, state_models, model_vehicle, model_fuel, state, age)
                    em_ages[str(age)] = [None if p is None else round(p, 6) for p in preds]

                output["emissions"][em_key_json] = {
                    "unit": em_unit,
                    "ages": em_ages,
                }

    return output


def main():
    out_dir = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "..", "frontend", "public", "pregenerated"
    )
    os.makedirs(out_dir, exist_ok=True)

    for state in STATES:
        print(f"\n{'='*60}", flush=True)
        print(f"  Loading models for {state}...", flush=True)
        print(f"{'='*60}", flush=True)
        t0 = time.time()
        state_models = load_state_models(state)

        print(f"  Generating predictions for {state}...", flush=True)
        data = generate_state(state, state_models)

        out_path = os.path.join(out_dir, f"{state}.json")
        with open(out_path, "w") as f:
            json.dump(data, f, separators=(",", ":"))

        size_mb = os.path.getsize(out_path) / (1024 * 1024)
        elapsed = time.time() - t0
        print(f"  => {out_path}  ({size_mb:.1f} MB, {elapsed:.0f}s)", flush=True)

    print("\nDone! All states generated.", flush=True)


if __name__ == "__main__":
    main()
