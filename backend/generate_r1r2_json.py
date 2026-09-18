"""
Generate R1 (hourly daily) and R2 (annual) JSON data files for the frontend
using the MOVES5-trained models and traffic data from Combined_sheet_output_speed.

Usage:
    python generate_r1r2_json.py
"""

import os
import json
import numpy as np
import pandas as pd
import torch
import sqlite3
from models import ModifiedNet

# ── Config ──────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, "prediction.db")
TRAFFIC_DIR = os.path.join(BASE_DIR, "Combined_sheet_output_speed")
OUTPUT_DIR = os.path.join(BASE_DIR, "..", "frontend", "src", "assets", "r1r2data")

STATES = ["GA", "CA", "NY", "WA"]
CITY_TO_STATE = {"Atlanta": "GA", "Los Angeles": "CA", "NewYork": "NY", "Seattle": "WA"}

# Fallback CSV traffic data directories (from UI Datasets archive)
UI_DATASETS_DIR = os.path.join(
    BASE_DIR, "..", "..",
    "20250611_UI Datasets, Map Files, and Logos",
    "20250611_UI Datasets, Map Files, and Logos",
    "Traffic Volume and Speed",
)
CSV_TRAFFIC_DIRS = {
    "GA": os.path.join(UI_DATASETS_DIR, "Georgia", "Updated_Traffic_Data_2024"),
    "CA": os.path.join(UI_DATASETS_DIR, "California", "Updated CA Traffic_Data_2024"),
    "NY": os.path.join(UI_DATASETS_DIR, "NewYork", "Updated NY Traffic_Data_2024"),
    "WA": os.path.join(UI_DATASETS_DIR, "Washington", "Updated WA Traffic_Data_2024"),
}

# R2 years
R2_YEARS = list(range(2024, 2031))  # 2024-2030

# Fuel conversion factors (from energy kJ to fuel units)
# 1 gallon gasoline = 120,238 kJ, diesel = 137,381 kJ, ethanol E85 = 81,800 kJ
# 1 GGE CNG = 120,238 kJ, 1 kWh = 3600 kJ
FUEL_ENERGY_KJ_PER_UNIT = {
    "Gasoline": 120238.0,
    "Diesel Fuel": 137381.0,
    "Ethanol (E-85)": 81800.0,
    "Compressed Natural Gas (CNG)": 120238.0,
    "Electricity": 3600.0,  # kJ per kWh -> then convert to MWh
}


def load_model_checkpoint(state, emission_key):
    """Load a trained model checkpoint."""
    # Try models/{STATE}/ first, then ml_models/
    for model_dir in [os.path.join(BASE_DIR, "models", state),
                      os.path.join(BASE_DIR, "ml_models")]:
        path = os.path.join(model_dir, f"best_model_{state}{emission_key}.pth")
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
    raise FileNotFoundError(f"No model found for {state}/{emission_key}")


def predict_batch(model_info, df_inputs):
    """Predict emissions for a batch of inputs."""
    preprocessor = model_info["preprocessor"]
    target_scaler = model_info["target_scaler"]
    model = model_info["model"]

    processed = preprocessor.transform(df_inputs)
    if hasattr(processed, "toarray"):
        tensor = torch.tensor(processed.toarray(), dtype=torch.float32)
    else:
        tensor = torch.tensor(processed, dtype=torch.float32)

    with torch.no_grad():
        raw = model(tensor)
        result = target_scaler.inverse_transform(raw.numpy())
    return result.flatten()


def normalize_fuel_type(ftype):
    """Normalize fuel type names from DB to match model-trained categories."""
    if not ftype or not isinstance(ftype, str):
        return ftype
    # Map common variants to the canonical model-trained names
    FUEL_ALIASES = {
        "compressed natural gas (cng)": "Compressed Natural Gas (CNG)",
        "compressed natural gas - cng": "Compressed Natural Gas (CNG)",
        "ethanol (e-85)": "Ethanol (E-85)",
        "ethanol - e-85": "Ethanol (E-85)",
        "diesel fuel": "Diesel Fuel",
        "gasoline": "Gasoline",
        "electricity": "Electricity",
    }
    return FUEL_ALIASES.get(ftype.strip().lower(), ftype)


def get_vehicle_fleet():
    """Get vehicle fleet composition (proportions) from the database."""
    conn = sqlite3.connect(DB_FILE)
    df = pd.read_sql_query(
        """SELECT data_vehicle_type as vehicle_type, fuel_type, SUM(vehicle_count) as count
           FROM vehicle_classification_data
           WHERE BaseYear=2024
           GROUP BY data_vehicle_type, fuel_type""",
        conn
    )
    conn.close()

    # Normalize fuel type names to match model-trained categories
    df["fuel_type"] = df["fuel_type"].apply(normalize_fuel_type)

    total = df["count"].sum()
    df["fraction"] = df["count"] / total
    return df


def get_traffic_data(state, year):
    """Load traffic data from Excel or CSV directories."""
    # Priority: ABM Direct > ABM Interpolated > MFD (Excel format)
    output_dir = os.path.join(TRAFFIC_DIR, state)
    for suffix in [f"_ABM.xlsx", f"_ABM_interpolated.xlsx", f".xlsx"]:
        path = os.path.join(output_dir, f"{state}_{year}{suffix}")
        if os.path.exists(path):
            return ("excel", pd.ExcelFile(path), path)

    # Fallback: CSV-based traffic data (only available for 2024)
    if year == 2024 and state in CSV_TRAFFIC_DIRS:
        csv_dir = CSV_TRAFFIC_DIRS[state]
        if os.path.isdir(csv_dir):
            csv_files = [f for f in os.listdir(csv_dir) if f.endswith(".csv")]
            if csv_files:
                return ("csv", csv_dir, csv_dir)

    return (None, None, None)


def load_tract_dataframes(fmt, source, path):
    """Load per-tract DataFrames from either Excel or CSV directory.
    Returns list of (tract_id, DataFrame) tuples."""
    tracts = []
    if fmt == "excel":
        for sheet_name in source.sheet_names:
            tract_id = sheet_name.split("tract=")[1] if "tract=" in sheet_name else sheet_name
            df = pd.read_excel(path, sheet_name=sheet_name)
            tracts.append((tract_id, df))
    elif fmt == "csv":
        csv_dir = source
        for fname in sorted(os.listdir(csv_dir)):
            if not fname.endswith(".csv"):
                continue
            tract_id = fname.replace("tract=", "").replace(".csv", "")
            try:
                df = pd.read_csv(os.path.join(csv_dir, fname))
                tracts.append((tract_id, df))
            except Exception as e:
                print(f"    Warning: skipping {fname}: {e}")
                continue
    return tracts


def compute_hourly_emissions(state, year, fleet_df, models):
    """
    Compute hourly emissions per tract for a given state and year.
    Returns dict: {tract_id: {metric: [25 hourly values]}}
    """
    fmt, source, path = get_traffic_data(state, year)
    if fmt is None:
        print(f"    No traffic data for {state}/{year}")
        return None

    print(f"    Using: {os.path.basename(path)}")
    tracts_data = {}

    tract_frames = load_tract_dataframes(fmt, source, path)
    for tract_id, df in tract_frames:
        # Get speed and volume columns
        speed_col = "Speed" if "Speed" in df.columns else "Traffic Speed"
        volume_col = "Traffic Volume"
        if speed_col not in df.columns or volume_col not in df.columns:
            continue

        speeds = df[speed_col].values
        volumes = df[volume_col].values

        # Traffic data has ~96 rows (15-min intervals).
        # Per Dr. Mahyar: compute emissions for each 15-min interval individually,
        # then sum every 4 intervals to get hourly values.
        n_points = len(speeds)
        points_per_hour = max(1, n_points // 24)

        # Prepare 15-min speeds and volumes (clamp speed min to 2.5 mph)
        interval_speeds = [max(2.5, float(s)) if np.isfinite(s) else 30.0 for s in speeds]
        interval_volumes = [float(v) if np.isfinite(v) else 0.0 for v in volumes]

        # Pad to ensure we have enough intervals for 25 hours
        n_intervals = 25 * points_per_hour
        while len(interval_speeds) < n_intervals:
            interval_speeds.append(interval_speeds[-1] if interval_speeds else 30.0)
            interval_volumes.append(interval_volumes[-1] if interval_volumes else 0.0)

        # For each 15-min interval, compute emissions then sum into hourly buckets
        n_intervals_used = min(len(interval_speeds), n_intervals)

        metrics = {
            "CO2": np.zeros(25),
            "NOx": np.zeros(25),
            "PM2.5B": np.zeros(25),
            "PM2.5T": np.zeros(25),
            "Gasoline": np.zeros(25),
            "Diesel": np.zeros(25),
            "Electricity": np.zeros(25),
            "Ethanol": np.zeros(25),
            "CNG": np.zeros(25),
        }

        # Map fuel types to metric keys
        fuel_to_metric = {
            "Gasoline": "Gasoline",
            "Diesel Fuel": "Diesel",
            "Electricity": "Electricity",
            "Ethanol (E-85)": "Ethanol",
            "Compressed Natural Gas (CNG)": "CNG",
        }

        for _, row in fleet_df.iterrows():
            vtype = row["vehicle_type"]
            ftype = row["fuel_type"]
            fraction = row["fraction"]

            if pd.isna(vtype) or pd.isna(ftype):
                continue

            # Build input DataFrame for ALL 15-min intervals
            inputs = pd.DataFrame({
                "Vehicle Type": [vtype] * n_intervals_used,
                "Fuel Type": [ftype] * n_intervals_used,
                "Age": [5] * n_intervals_used,  # Average age
                "Speed": interval_speeds[:n_intervals_used],
            })

            vol_arr = np.array(interval_volumes[:n_intervals_used])

            # Predict each emission type independently so one failure
            # doesn't skip others (e.g. CO2/NOx models lack Electricity)
            for em_key, em_model, scale, metric_key in [
                ("CO2",       "CO2",       1e6, "CO2"),
                ("NOx",       "NOx",       1e3, "NOx"),
                ("PM2.5B",    "PM25Brake", 1.0, "PM2.5B"),
                ("PM2.5T",    "PM25Tire",  1.0, "PM2.5T"),
            ]:
                try:
                    rates = predict_batch(models[em_model], inputs)
                    rates = np.nan_to_num(np.maximum(rates, 0))
                    interval_emissions = rates * vol_arr * fraction / scale
                    # Sum each group of intervals into hourly buckets
                    for h in range(25):
                        start = h * points_per_hour
                        end = min(start + points_per_hour, n_intervals_used)
                        metrics[metric_key][h] += np.sum(interval_emissions[start:end])
                except Exception:
                    pass  # Model doesn't support this fuel type

            # Energy → fuel consumption (separate try so it always runs)
            try:
                energy_rates = predict_batch(models["Energy"], inputs)
                energy_rates = np.nan_to_num(np.maximum(energy_rates, 0))

                fuel_key = fuel_to_metric.get(ftype)
                if fuel_key and ftype in FUEL_ENERGY_KJ_PER_UNIT:
                    kj_per_unit = FUEL_ENERGY_KJ_PER_UNIT[ftype]
                    interval_consumption = energy_rates / kj_per_unit * vol_arr * fraction
                    if fuel_key == "Electricity":
                        interval_consumption /= 1000.0  # kWh -> MWh
                    # Sum each group of intervals into hourly buckets
                    for h in range(25):
                        start = h * points_per_hour
                        end = min(start + points_per_hour, n_intervals_used)
                        metrics[fuel_key][h] += np.sum(interval_consumption[start:end])
            except Exception:
                pass

        tracts_data[tract_id] = {k: [round(v, 6) for v in vals] for k, vals in metrics.items()}

    return tracts_data


def build_r1_json(tracts_data):
    """Build R1 JSON structure (hourly daily data)."""
    labels = [f"{h}:00" for h in range(25)]

    r1 = {}
    metric_units = {
        "CO2": "CO\u2082 (ton)",
        "NOx": "NO\u2093 (kg)",
        "PM2.5B": "PM2.5 Brakes (gm)",
        "PM2.5T": "PM2.5 Tires (gm)",
        "Electricity": "Electricity (MWh)",
        "Gasoline": "Gasoline (Gallon)",
        "Diesel": "Diesel (Gallon)",
        "Ethanol": "Ethanol E85 (Gallon)",
        "CNG": "CNG (GGE)",
    }

    for metric_key, unit in metric_units.items():
        tracts = {}
        for tract_id, tract_metrics in tracts_data.items():
            tracts[tract_id] = tract_metrics[metric_key]
        r1[metric_key] = {"labels": labels, "unit": unit, "tracts": tracts}

    return r1


def build_r2_json(state, fleet_df, models):
    """Build R2 JSON structure (annual data across years)."""
    labels = [str(y) for y in R2_YEARS]
    metric_units = {
        "CO2": "CO\u2082 (ton)",
        "NOx": "NO\u2093 (kg)",
        "PM2.5B": "PM2.5 Brakes (gm)",
        "PM2.5T": "PM2.5 Tires (gm)",
        "Electricity": "Electricity (MWh)",
        "Gasoline": "Gasoline (Gallon)",
        "Diesel": "Diesel (Gallon)",
        "Ethanol": "Ethanol E85 (Gallon)",
        "CNG": "CNG (GGE)",
    }

    # Collect all tracts from first available year
    all_tracts = set()
    yearly_data = {}

    for year in R2_YEARS:
        print(f"  R2 year {year}:")
        tracts_data = compute_hourly_emissions(state, year, fleet_df, models)
        if tracts_data is None:
            # Reuse base year 2024 data if available (same traffic, same model)
            if 2024 in yearly_data:
                print(f"    -> Reusing 2024 data for {year}")
                tracts_data = yearly_data[2024]
            else:
                continue
        yearly_data[year] = tracts_data
        all_tracts.update(tracts_data.keys())

    if not yearly_data:
        return None

    # Build R2: for each tract, sum daily (25 hourly values) for each year
    r2 = {}
    for metric_key, unit in metric_units.items():
        tracts = {}
        for tract_id in sorted(all_tracts):
            annual_values = []
            for year in R2_YEARS:
                if year in yearly_data and tract_id in yearly_data[year]:
                    daily_total = sum(yearly_data[year][tract_id][metric_key])
                    annual_total = daily_total * 365  # Scale daily to annual
                    annual_values.append(round(annual_total, 6))
                else:
                    # Interpolate from nearest available years
                    annual_values.append(0.0)
            tracts[tract_id] = annual_values
        r2[metric_key] = {"labels": labels, "unit": unit, "tracts": tracts}

    return r2


def main():
    print("Loading vehicle fleet composition...")
    fleet_df = get_vehicle_fleet()
    print(f"  {len(fleet_df)} vehicle-fuel combinations, {fleet_df['count'].sum()} total vehicles")

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    for state in STATES:
        print(f"\n{'='*60}")
        print(f"Generating R1/R2 for {state}")
        print(f"{'='*60}")

        # Load all 5 models for this state
        print(f"  Loading models for {state}...")
        models = {}
        for key in ["CO2", "Energy", "NOx", "PM25Brake", "PM25Tire"]:
            models[key] = load_model_checkpoint(state, key)

        # R1: Use base year 2024 (or latest available)
        print(f"\n  Generating R1 (daily hourly)...")
        base_year = 2024
        tracts_data = compute_hourly_emissions(state, base_year, fleet_df, models)

        if tracts_data:
            r1 = build_r1_json(tracts_data)
            r1_path = os.path.join(OUTPUT_DIR, f"{state}_R1.json")
            with open(r1_path, "w", encoding="utf-8") as f:
                json.dump(r1, f, ensure_ascii=False)
            print(f"  -> Saved {r1_path} ({len(tracts_data)} tracts)")
        else:
            print(f"  -> SKIPPED R1 (no traffic data for {base_year})")

        # R2: Annual data across 2024-2030
        print(f"\n  Generating R2 (annual)...")
        r2 = build_r2_json(state, fleet_df, models)
        if r2:
            r2_path = os.path.join(OUTPUT_DIR, f"{state}_R2.json")
            with open(r2_path, "w", encoding="utf-8") as f:
                json.dump(r2, f, ensure_ascii=False)
            print(f"  -> Saved {r2_path}")
        else:
            print(f"  -> SKIPPED R2 (no traffic data)")

    print("\nDone! R1/R2 JSON files regenerated with MOVES5 models.")


if __name__ == "__main__":
    main()
