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

# Suppress sklearn NaN warnings (expected for some inverse transforms)
warnings.filterwarnings("ignore", category=UserWarning, module="sklearn")

# Make imports work when running from the backend directory
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from models import ModifiedNet

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

KJ_PER_UNIT = {
    "Gasoline": 123462.432,
    "Diesel Fuel": 138451.739,
    "Ethanol - E-85": 85729.28,
    "Compressed Natural Gas - CNG": 124854.529,
    "Electricity": 3600.0,
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
    try:
        checkpoint = torch.load(file_path, map_location="cpu")
    except Exception:
        checkpoint = torch.load(file_path, map_location="cpu", weights_only=False)

    model = ModifiedNet(input_features)
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

    processed = preprocessor.transform(df)
    if hasattr(processed, "toarray"):
        tensor = torch.tensor(processed.toarray(), dtype=torch.float32)
    else:
        tensor = torch.tensor(processed, dtype=torch.float32)

    with torch.no_grad():
        raw = model(tensor)
        preds = target_scaler.inverse_transform(raw.numpy())

    import math
    return [None if math.isnan(p[0]) else float(p[0]) for p in preds]


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
                values = [None if p is None else round((p * 3600 / 62.1371) / kj_per_unit, 8) for p in preds]
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
