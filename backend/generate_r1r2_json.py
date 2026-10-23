"""
Generate R1 (hourly daily) and R2 (annual) JSON data files for the frontend
using the MOVES5-trained models and traffic data from Combined_sheet_output_speed.

Supports manifest-based provenance, traffic-level interpolation between anchor
years, and dynamic year ranges.

Usage:
    python generate_r1r2_json.py                        # legacy: all states, 2024-2030
    python generate_r1r2_json.py --state GA             # single state, uses manifest
    python generate_r1r2_json.py --state GA --output-dir /path/to/out
"""

import os
import json
import argparse
import copy
import numpy as np
import pandas as pd
import torch
import sqlite3
from datetime import datetime, timezone
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

# ── Config ──────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, "prediction.db")
TRAFFIC_DIR = os.path.join(BASE_DIR, "Combined_sheet_output_speed")
DEFAULT_OUTPUT_DIR = os.path.join(BASE_DIR, "..", "frontend", "src", "assets", "r1r2data")

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

# MOVES-standard Lower Heating Values (LHV) — EPA-420-R-21-006, Table 4-1.
# Model "Total Energy" output is in kJ/mile (LHV-based); divide by these to get fuel_unit/mile.
FUEL_ENERGY_KJ_PER_UNIT = {
    "Gasoline": 120238.0,
    "Diesel Fuel": 137381.0,
    "Ethanol (E-85)": 81800.0,
    "Compressed Natural Gas (CNG)": 120238.0,
    "Electricity": 3600.0,  # kJ per kWh -> then convert to MWh
}


# ── Manifest ────────────────────────────────────────────────────────────────

def load_manifest(state):
    """Load manifest.json for a state. Returns None if no manifest exists."""
    manifest_path = os.path.join(TRAFFIC_DIR, state, "manifest.json")
    if not os.path.exists(manifest_path):
        return None
    try:
        with open(manifest_path) as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return None


def get_anchor_years(manifest):
    """Extract sorted list of genuinely uploaded years from manifest.
    Only entries with source='user_upload' are trusted."""
    if not manifest or "uploads" not in manifest:
        return []
    anchors = []
    for year_str, info in manifest["uploads"].items():
        if info.get("source") == "user_upload":
            anchors.append(int(year_str))
    return sorted(anchors)


def get_year_range(manifest):
    """Determine the year range for R2 generation.
    Uses manifest baseYear as start. End year is the manifest endYear
    (the user's selected projected year). ABM anchors beyond endYear
    are still used for interpolation/extrapolation but do not extend
    the output range."""
    if manifest:
        base = manifest.get("baseYear")
        end = manifest.get("endYear")
        if base and end:
            return list(range(base, end + 1))
    # Fallback: use anchor years span
    anchors = get_anchor_years(manifest)
    if len(anchors) >= 2:
        return list(range(anchors[0], anchors[-1] + 1))
    # No manifest or single anchor: default 2024-2030
    return list(range(2024, 2031))


# ── Model loading ───────────────────────────────────────────────────────────

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

    df_inputs = add_age_bin(df_inputs)
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


def get_vehicle_fleet(year=2024):
    """Get vehicle fleet composition (proportions) from the database for a specific BaseYear.
    Groups by (vehicle_type, fuel_type, age) when age data is available,
    otherwise groups by (vehicle_type, fuel_type)."""
    conn = sqlite3.connect(DB_FILE)
    df = pd.read_sql_query(
        "SELECT data_vehicle_type as vehicle_type, fuel_type, age, SUM(vehicle_count) as count "
        "FROM vehicle_classification_data WHERE BaseYear=? "
        "GROUP BY data_vehicle_type, fuel_type, age",
        conn, params=(year,)
    )
    conn.close()

    if df.empty:
        return df  # caller must check

    # Normalize fuel type names to match model-trained categories
    df["fuel_type"] = df["fuel_type"].apply(normalize_fuel_type)

    # If all ages are NULL, drop the age column (legacy data without age info)
    if df["age"].isna().all():
        df = df.drop(columns=["age"])

    total = df["count"].sum()
    df["fraction"] = df["count"] / total
    return df


def get_vr_anchor_years(manifest):
    """Sorted list of years with uploaded VR (vehicle registration/classification) data."""
    if not manifest:
        return []
    vr = manifest.get("vrUploads", {})
    return sorted(int(y) for y in vr.keys())


def blend_fleets(fleet_lo, fleet_hi, alpha):
    """Linearly blend two fleet DataFrames by vehicle counts.

    Merge keys are (vehicle_type, fuel_type) plus age if present in both frames.
    Blends counts: count = lo_count*(1-alpha) + hi_count*alpha
    Clamps counts >= 0, rounds to int, recomputes fractions.
    Drops rows where blended count == 0.
    """
    # Determine merge keys
    merge_keys = ["vehicle_type", "fuel_type"]
    if "age" in fleet_lo.columns and "age" in fleet_hi.columns:
        merge_keys.append("age")

    lo = fleet_lo[merge_keys + ["count"]].rename(columns={"count": "count_lo"})
    hi = fleet_hi[merge_keys + ["count"]].rename(columns={"count": "count_hi"})

    merged = pd.merge(lo, hi, on=merge_keys, how="outer")
    merged["count_lo"] = merged["count_lo"].fillna(0)
    merged["count_hi"] = merged["count_hi"].fillna(0)

    merged["count"] = merged["count_lo"] * (1 - alpha) + merged["count_hi"] * alpha
    merged["count"] = merged["count"].clip(lower=0).round().astype(int)

    # Drop rows with zero count (vehicle types that disappeared)
    merged = merged[merged["count"] > 0].copy()

    if merged.empty:
        return merged

    total = merged["count"].sum()
    merged["fraction"] = merged["count"] / total if total > 0 else 0.0

    # Keep only the standard columns
    result_cols = merge_keys + ["count", "fraction"]
    return merged[result_cols].reset_index(drop=True)


def interpolate_fleet(target_year, vr_anchor_years, vr_fleet_cache):
    """Resolve fleet for target_year using interpolation/extrapolation across VR anchors.

    Returns (fleet_df, provenance_dict) where provenance_dict has keys:
      vrSource: "uploaded" | "interpolated" | "extrapolated" | "constant"
      vrAnchors: list of anchor years used
      vrWarning: (optional) warning string for single-anchor case
    """
    if not vr_anchor_years:
        return None, {}

    anchors = sorted(vr_anchor_years)

    # Exact match → uploaded
    if target_year in anchors:
        fleet = vr_fleet_cache.get(target_year)
        return fleet, {"vrSource": "uploaded", "vrAnchors": [target_year]}

    # Single anchor → constant (reuse unchanged, with warning)
    if len(anchors) == 1:
        fleet = vr_fleet_cache.get(anchors[0])
        return fleet, {
            "vrSource": "constant",
            "vrAnchors": anchors,
            "vrWarning": f"Only one VR upload ({anchors[0]}). Trend-based estimation requires 2+ uploads.",
        }

    # 2+ anchors: determine bounding pair
    lower_anchors = [a for a in anchors if a <= target_year]
    upper_anchors = [a for a in anchors if a >= target_year]

    if lower_anchors and upper_anchors:
        lo_year = max(lower_anchors)
        hi_year = min(upper_anchors)
        if lo_year == hi_year:
            fleet = vr_fleet_cache.get(lo_year)
            return fleet, {"vrSource": "uploaded", "vrAnchors": [lo_year]}
        source = "interpolated"
    elif not lower_anchors:
        # Before earliest anchor → extrapolate using 2 earliest
        lo_year, hi_year = anchors[0], anchors[1]
        source = "extrapolated"
    else:
        # After latest anchor → extrapolate using 2 latest
        lo_year, hi_year = anchors[-2], anchors[-1]
        source = "extrapolated"

    alpha = (target_year - lo_year) / (hi_year - lo_year)

    fleet_lo = vr_fleet_cache.get(lo_year)
    fleet_hi = vr_fleet_cache.get(hi_year)
    if fleet_lo is None or fleet_hi is None:
        return None, {}

    blended = blend_fleets(fleet_lo, fleet_hi, alpha)
    return blended, {
        "vrSource": source,
        "vrAnchors": [lo_year, hi_year],
    }


# ── Traffic data loading ────────────────────────────────────────────────────

def get_traffic_data(state, year, manifest=None):
    """Load traffic data, provenance-aware.
    Returns (fmt, source, path, provenance) where provenance is one of:
      'uploaded' — file recorded in manifest as user_upload
      'legacy'   — file exists on disk but not in manifest (untrusted)
      None       — no data found
    """
    output_dir = os.path.join(TRAFFIC_DIR, state)

    # Check manifest first
    if manifest and "uploads" in manifest:
        upload_info = manifest["uploads"].get(str(year))
        if upload_info and upload_info.get("source") == "user_upload":
            fname = upload_info["file"]
            path = os.path.join(output_dir, fname)
            if os.path.exists(path):
                return ("excel", pd.ExcelFile(path), path, "uploaded")

    # If manifest exists, do NOT fall back to filesystem scan for non-manifest files.
    # Only look for CSV fallback for base year if no manifest.
    if manifest:
        return (None, None, None, None)

    # No manifest: legacy behavior — scan filesystem
    for suffix in ["_ABM.xlsx", "_ABM_interpolated.xlsx", ".xlsx"]:
        path = os.path.join(output_dir, f"{state}_{year}{suffix}")
        if os.path.exists(path):
            return ("excel", pd.ExcelFile(path), path, "legacy")

    # Fallback: CSV-based traffic data (only available for 2024)
    if year == 2024 and state in CSV_TRAFFIC_DIRS:
        csv_dir = CSV_TRAFFIC_DIRS[state]
        if os.path.isdir(csv_dir):
            csv_files = [f for f in os.listdir(csv_dir) if f.endswith(".csv")]
            if csv_files:
                return ("csv", csv_dir, csv_dir, "legacy")

    return (None, None, None, None)


def _time_str_to_seconds(t):
    """Parse a time string like '0:00:00' or '13:45:00' to total seconds."""
    try:
        parts = str(t).split(":")
        return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    except (ValueError, IndexError):
        return 0


def load_tract_dataframes(fmt, source, path):
    """Load per-tract DataFrames from either Excel or CSV directory.
    Returns list of (tract_id, DataFrame) tuples, sorted chronologically by Time."""
    tracts = []
    if fmt == "excel":
        for sheet_name in source.sheet_names:
            tract_id = sheet_name.split("tract=")[1] if "tract=" in sheet_name else sheet_name
            df = pd.read_excel(path, sheet_name=sheet_name)
            if "Time" in df.columns:
                df["_time_seconds"] = df["Time"].apply(_time_str_to_seconds)
                df = df.sort_values("_time_seconds").reset_index(drop=True)
                df = df.drop(columns=["_time_seconds"])
            tracts.append((tract_id, df))
    elif fmt == "csv":
        csv_dir = source
        for fname in sorted(os.listdir(csv_dir)):
            if not fname.endswith(".csv"):
                continue
            tract_id = fname.replace("tract=", "").replace(".csv", "")
            try:
                df = pd.read_csv(os.path.join(csv_dir, fname))
                if "Time" in df.columns:
                    df["_time_seconds"] = df["Time"].apply(_time_str_to_seconds)
                    df = df.sort_values("_time_seconds").reset_index(drop=True)
                    df = df.drop(columns=["_time_seconds"])
                tracts.append((tract_id, df))
            except Exception as e:
                print(f"    Warning: skipping {fname}: {e}")
                continue
    return tracts


# ── Anchor compatibility validation ────────────────────────────────────────

def validate_anchor_compatibility(state, anchor_years, manifest):
    """Validate that anchor-year datasets are compatible for interpolation.
    Checks: matching tract IDs, matching row counts, matching columns.
    Returns (is_valid, errors_list)."""
    if len(anchor_years) < 2:
        return True, []

    errors = []
    anchor_tracts = {}  # {year: {tract_id: (n_rows, columns)}}

    for year in anchor_years:
        fmt, source, path, prov = get_traffic_data(state, year, manifest)
        if fmt is None:
            errors.append(f"Anchor year {year}: no traffic data found")
            continue

        frames = load_tract_dataframes(fmt, source, path)
        tract_info = {}
        for tract_id, df in frames:
            speed_col = "Speed" if "Speed" in df.columns else "Traffic Speed"
            volume_col = "Traffic Volume"
            relevant_cols = sorted([c for c in df.columns if c in [speed_col, volume_col, "Time"]])
            tract_info[tract_id] = (len(df), relevant_cols)
        anchor_tracts[year] = tract_info

    if len(anchor_tracts) < 2:
        return len(errors) == 0, errors

    # Compare all anchors against the first
    ref_year = anchor_years[0]
    ref_info = anchor_tracts.get(ref_year, {})
    ref_tract_ids = set(ref_info.keys())

    for year in anchor_years[1:]:
        year_info = anchor_tracts.get(year, {})
        year_tract_ids = set(year_info.keys())

        # Check tract ID overlap
        missing = ref_tract_ids - year_tract_ids
        extra = year_tract_ids - ref_tract_ids
        if missing:
            errors.append(f"Year {year} missing tracts present in {ref_year}: {sorted(missing)[:5]}...")
        if extra:
            errors.append(f"Year {year} has extra tracts not in {ref_year}: {sorted(extra)[:5]}...")

        # Check row counts and columns for common tracts
        common = ref_tract_ids & year_tract_ids
        for tract_id in sorted(common)[:3]:  # spot-check first 3
            ref_rows, ref_cols = ref_info[tract_id]
            yr_rows, yr_cols = year_info[tract_id]
            if ref_rows != yr_rows:
                errors.append(
                    f"Tract {tract_id}: {ref_year} has {ref_rows} rows vs {year} has {yr_rows} rows"
                )
            if ref_cols != yr_cols:
                errors.append(
                    f"Tract {tract_id}: column mismatch between {ref_year} and {year}"
                )

    return len(errors) == 0, errors


# ── Traffic interpolation ───────────────────────────────────────────────────

def interpolate_traffic(state, target_year, anchor_years, manifest):
    """Linearly interpolate or extrapolate Traffic Volume and Speed between/beyond
    ABM anchor years for target_year.

    Returns (frames, traffic_provenance) where:
      frames: list of (tract_id, DataFrame)
      traffic_provenance: dict with traffic source info

    Handles:
      - Exact anchor match → loaded directly ("uploaded")
      - 2+ anchors, between → interpolated
      - 2+ anchors, outside → extrapolated
      - 1 anchor → "constant" with warning
    Returns (None, {}) if no data available."""
    if not anchor_years:
        return None, {}

    anchors = sorted(anchor_years)

    # Exact match
    if target_year in anchors:
        fmt, source, path, _ = get_traffic_data(state, target_year, manifest)
        if fmt is None:
            return None, {}
        frames = load_tract_dataframes(fmt, source, path)
        return frames, {"traffic": "uploaded"}

    # Single anchor → constant reuse
    if len(anchors) == 1:
        fmt, source, path, _ = get_traffic_data(state, anchors[0], manifest)
        if fmt is None:
            return None, {}
        frames = load_tract_dataframes(fmt, source, path)
        return frames, {
            "traffic": "constant",
            "trafficAnchors": anchors,
            "trafficWarning": f"Only one ABM upload ({anchors[0]}). Trend-based estimation requires 2+ uploads.",
        }

    # 2+ anchors: determine bounding pair and source label
    lower_anchors = [a for a in anchors if a <= target_year]
    upper_anchors = [a for a in anchors if a >= target_year]

    if lower_anchors and upper_anchors:
        lo_year = max(lower_anchors)
        hi_year = min(upper_anchors)
        if lo_year == hi_year:
            fmt, source, path, _ = get_traffic_data(state, lo_year, manifest)
            if fmt is None:
                return None, {}
            frames = load_tract_dataframes(fmt, source, path)
            return frames, {"traffic": "uploaded"}
        source_label = "interpolated"
    elif not lower_anchors:
        lo_year, hi_year = anchors[0], anchors[1]
        source_label = "extrapolated"
    else:
        lo_year, hi_year = anchors[-2], anchors[-1]
        source_label = "extrapolated"

    alpha = (target_year - lo_year) / (hi_year - lo_year)

    # Load both anchor datasets
    fmt_lo, src_lo, path_lo, _ = get_traffic_data(state, lo_year, manifest)
    fmt_hi, src_hi, path_hi, _ = get_traffic_data(state, hi_year, manifest)
    if fmt_lo is None or fmt_hi is None:
        return None, {}

    frames_lo = load_tract_dataframes(fmt_lo, src_lo, path_lo)
    frames_hi = load_tract_dataframes(fmt_hi, src_hi, path_hi)

    lo_dict = {tid: df for tid, df in frames_lo}
    hi_dict = {tid: df for tid, df in frames_hi}

    common_tracts = sorted(set(lo_dict.keys()) & set(hi_dict.keys()))
    if not common_tracts:
        return None, {}

    result = []
    for tract_id in common_tracts:
        df_lo = lo_dict[tract_id]
        df_hi = hi_dict[tract_id]

        speed_col = "Speed" if "Speed" in df_lo.columns else "Traffic Speed"
        volume_col = "Traffic Volume"

        if speed_col not in df_lo.columns or volume_col not in df_lo.columns:
            continue
        if speed_col not in df_hi.columns or volume_col not in df_hi.columns:
            continue

        n_rows = min(len(df_lo), len(df_hi))
        df_interp = df_lo.iloc[:n_rows].copy()

        lo_speed = df_lo[speed_col].values[:n_rows].astype(float)
        hi_speed = df_hi[speed_col].values[:n_rows].astype(float)
        lo_vol = df_lo[volume_col].values[:n_rows].astype(float)
        hi_vol = df_hi[volume_col].values[:n_rows].astype(float)

        lo_speed = np.where(np.isfinite(lo_speed), lo_speed, 30.0)
        hi_speed = np.where(np.isfinite(hi_speed), hi_speed, 30.0)
        lo_vol = np.where(np.isfinite(lo_vol), lo_vol, 0.0)
        hi_vol = np.where(np.isfinite(hi_vol), hi_vol, 0.0)

        df_interp[speed_col] = np.maximum(lo_speed * (1 - alpha) + hi_speed * alpha, 0.0)
        df_interp[volume_col] = np.maximum(lo_vol * (1 - alpha) + hi_vol * alpha, 0.0)

        result.append((tract_id, df_interp))

    if not result:
        return None, {}

    prov = {"traffic": source_label, "trafficAnchors": [lo_year, hi_year]}
    return result, prov


# ── Core emission computation ──────────────────────────────────────────────

def collapse_fleet_for_prediction(fleet_df):
    """Collapse per-age fleet rows into per-(vehicle_type, fuel_type) rows with
    weighted-average age.  This keeps interpolation accurate at the age level
    while limiting the number of rows iterated during emission prediction.

    If the fleet has no 'age' column or only one row per combo, returns as-is.
    """
    if "age" not in fleet_df.columns:
        return fleet_df

    group_keys = ["vehicle_type", "fuel_type"]
    # Weighted average age (weight = count)
    def _agg(g):
        total = g["count"].sum()
        if total > 0 and g["age"].notna().any():
            wavg_age = (g["age"].fillna(5) * g["count"]).sum() / total
        else:
            wavg_age = 5.0
        return pd.Series({"count": total, "age": round(wavg_age)})

    agg = fleet_df.groupby(group_keys, sort=False).apply(_agg).reset_index()
    total = agg["count"].sum()
    agg["fraction"] = agg["count"] / total if total > 0 else 0.0
    return agg


def compute_hourly_emissions(state, year, fleet_df, models,
                             manifest=None, tract_dataframes=None):
    """
    Compute hourly emissions per tract for a given state and year.

    If tract_dataframes is provided (list of (tract_id, DataFrame)),
    uses those directly instead of loading from disk.

    Returns (tracts_data, tracts_byFuel) where:
      tracts_data:   {tract_id: {metric: [25 hourly values]}}
      tracts_byFuel: {tract_id: {fuel: {emission: [25 hourly values]}}}
    """
    # Collapse per-age rows to per-(vehicle_type, fuel_type) with weighted avg age
    # to keep prediction fast (e.g. 854 age-rows → ~45 combos)
    fleet_df = collapse_fleet_for_prediction(fleet_df)
    if tract_dataframes is not None:
        tract_frames = tract_dataframes
        print(f"    Using pre-loaded DataFrames ({len(tract_frames)} tracts)")
    else:
        fmt, source, path, prov = get_traffic_data(state, year, manifest)
        if fmt is None:
            print(f"    No traffic data for {state}/{year}")
            return None, None
        print(f"    Using: {os.path.basename(path)} (provenance: {prov})")
        tract_frames = load_tract_dataframes(fmt, source, path)

    tracts_data = {}
    tracts_byFuel = {}

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

        # Per-fuel emission breakdowns
        EMISSION_KEYS = ["CO2", "NOx", "PM2.5B", "PM2.5T"]
        FUEL_METRIC_KEYS = ["Gasoline", "Diesel", "Electricity", "Ethanol", "CNG"]
        byFuel = {
            fk: {ek: np.zeros(25) for ek in EMISSION_KEYS}
            for fk in FUEL_METRIC_KEYS
        }

        for _, row in fleet_df.iterrows():
            vtype = row["vehicle_type"]
            ftype = row["fuel_type"]
            fraction = row["fraction"]
            age_val = row.get("age", 5) if "age" in fleet_df.columns else 5
            if pd.isna(age_val):
                age_val = 5  # default average age when age data unavailable

            if pd.isna(vtype) or pd.isna(ftype):
                continue

            fuel_key = fuel_to_metric.get(ftype)

            # Build input DataFrame for ALL 15-min intervals
            inputs = pd.DataFrame({
                "Vehicle Type": [vtype] * n_intervals_used,
                "Fuel Type": [ftype] * n_intervals_used,
                "Age": [int(age_val)] * n_intervals_used,
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
                # Electricity produces zero CO2/NOx — skip for both aggregate and byFuel
                if ftype == "Electricity" and metric_key in ("CO2", "NOx"):
                    continue

                try:
                    rates = predict_batch(models[em_model], inputs)
                    rates = np.nan_to_num(np.maximum(rates, 0))
                    interval_emissions = rates * vol_arr * fraction / scale
                    # Sum each group of intervals into hourly buckets
                    for h in range(25):
                        start = h * points_per_hour
                        end = min(start + points_per_hour, n_intervals_used)
                        hourly_val = np.sum(interval_emissions[start:end])
                        metrics[metric_key][h] += hourly_val
                        if fuel_key:
                            byFuel[fuel_key][metric_key][h] += hourly_val
                except Exception:
                    pass  # Model doesn't support this fuel type

            # Energy → fuel consumption (separate try so it always runs)
            try:
                energy_rates = predict_batch(models["Energy"], inputs)
                energy_rates = np.nan_to_num(np.maximum(energy_rates, 0))

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
        tracts_byFuel[tract_id] = {
            fk: {ek: [round(v, 6) for v in vals] for ek, vals in em_dict.items()}
            for fk, em_dict in byFuel.items()
        }

    return tracts_data, tracts_byFuel


# ── JSON builders ───────────────────────────────────────────────────────────

def build_r1_json(tracts_data, tracts_byFuel):
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

    emission_units = {
        "CO2": "CO\u2082 (ton)",
        "NOx": "NO\u2093 (kg)",
        "PM2.5B": "PM2.5 Brakes (gm)",
        "PM2.5T": "PM2.5 Tires (gm)",
    }

    for metric_key, unit in metric_units.items():
        tracts = {}
        for tract_id, tract_metrics in tracts_data.items():
            tracts[tract_id] = tract_metrics[metric_key]
        r1[metric_key] = {"labels": labels, "unit": unit, "tracts": tracts}

    # Per-fuel emission breakdowns
    FUEL_METRIC_KEYS = ["Gasoline", "Diesel", "Electricity", "Ethanol", "CNG"]
    EMISSION_KEYS = ["CO2", "NOx", "PM2.5B", "PM2.5T"]
    by_fuel = {}
    for fk in FUEL_METRIC_KEYS:
        by_fuel[fk] = {}
        for ek in EMISSION_KEYS:
            tracts = {}
            for tract_id in tracts_data:
                tracts[tract_id] = tracts_byFuel[tract_id][fk][ek]
            by_fuel[fk][ek] = {"labels": labels, "unit": emission_units[ek], "tracts": tracts}
    r1["byFuel"] = by_fuel

    return r1


def build_r2_json(state, models, manifest=None, legacy_fleet_df=None):
    """Build R2 JSON structure (annual data across years).

    Per-year fleet resolution: each simulation year uses interpolated or
    extrapolated VR (vehicle classification) data based on uploaded anchors.
    Falls back to legacy_fleet_df (BaseYear=2024) if no VR uploads exist.

    Two-pass generation:
      Pass 1: Compute emissions for ABM anchor years (uploaded traffic data only)
      Pass 2: Interpolate/extrapolate traffic for remaining years, then run ML models
    """
    r2_years = get_year_range(manifest)
    labels = [str(y) for y in r2_years]
    abm_anchor_years = get_anchor_years(manifest)

    # VR (vehicle classification) anchor years for interpolation/extrapolation
    vr_anchor_years = get_vr_anchor_years(manifest)

    # Pre-load all VR anchor fleets into cache
    vr_fleet_cache = {}
    for vy in vr_anchor_years:
        fleet = get_vehicle_fleet(vy)
        vr_fleet_cache[vy] = fleet if not fleet.empty else None

    def _get_fleet_for_year(sim_year):
        """Resolve fleet for a simulation year via interpolation/extrapolation."""
        if vr_anchor_years:
            fleet, vr_prov = interpolate_fleet(sim_year, vr_anchor_years, vr_fleet_cache)
            if fleet is not None and not fleet.empty:
                return fleet, vr_prov
        # Fallback: legacy fleet
        if legacy_fleet_df is not None and not legacy_fleet_df.empty:
            return legacy_fleet_df, {}
        return None, {}

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

    # Track provenance per year
    year_provenance = {}
    all_tracts = set()
    yearly_data = {}
    yearly_byFuel = {}

    def _compute_for_year(year, tract_dataframes=None):
        """Compute emissions for a year, resolving fleet via interpolation/extrapolation."""
        fleet, vr_prov = _get_fleet_for_year(year)
        if fleet is None or fleet.empty:
            print(f"    WARNING: No fleet data available for year {year}")
            return None, None, {}
        vr_src = vr_prov.get("vrSource", "")
        if vr_src:
            anchors_str = ",".join(str(a) for a in vr_prov.get("vrAnchors", []))
            print(f"    Fleet: vrSource={vr_src}, anchors=[{anchors_str}]")
        td, tbf = compute_hourly_emissions(
            state, year, fleet, models,
            manifest=manifest, tract_dataframes=tract_dataframes
        )
        return td, tbf, vr_prov

    if abm_anchor_years:
        # ── Pass 1: Compute ABM anchor years ──
        print(f"  Pass 1: Computing ABM anchor years {abm_anchor_years}...")
        for year in abm_anchor_years:
            if year not in r2_years:
                continue
            print(f"  R2 anchor year {year}:")
            tracts_data, tracts_byFuel, vr_prov = _compute_for_year(year)
            if tracts_data is None:
                print(f"    WARNING: Anchor year {year} has no traffic data!")
                continue
            yearly_data[year] = tracts_data
            yearly_byFuel[year] = tracts_byFuel
            all_tracts.update(tracts_data.keys())
            prov = {"traffic": "uploaded"}
            prov.update(vr_prov)
            year_provenance[str(year)] = prov

        # ── Pass 2: Interpolate/extrapolate remaining years ──
        valid_abm_anchors = sorted(y for y in abm_anchor_years if y in yearly_data)

        if valid_abm_anchors:
            # Validate compatibility before interpolating
            if len(valid_abm_anchors) >= 2:
                is_valid, compat_errors = validate_anchor_compatibility(state, valid_abm_anchors, manifest)
                if not is_valid:
                    print(f"  WARNING: Anchor compatibility issues:")
                    for err in compat_errors:
                        print(f"    - {err}")
                    print(f"  Proceeding with interpolation despite warnings...")

            remaining_years = [y for y in r2_years if y not in yearly_data]
            if remaining_years:
                print(f"  Pass 2: Interpolating/extrapolating for years {remaining_years}...")

            for year in remaining_years:
                # Use new interpolate_traffic with extrapolation support
                interp_frames, traffic_prov = interpolate_traffic(
                    state, year, valid_abm_anchors, manifest
                )
                if interp_frames is None:
                    print(f"    WARNING: Could not resolve traffic for {year}")
                    continue

                print(f"  R2 {traffic_prov.get('traffic', '?')} year {year}:")
                tracts_data, tracts_byFuel, vr_prov = _compute_for_year(
                    year, tract_dataframes=interp_frames
                )
                if tracts_data:
                    yearly_data[year] = tracts_data
                    yearly_byFuel[year] = tracts_byFuel
                    all_tracts.update(tracts_data.keys())
                    prov = dict(traffic_prov)
                    prov.update(vr_prov)
                    year_provenance[str(year)] = prov
    else:
        # No manifest or no anchors: legacy behavior
        print(f"  No manifest — using legacy file scan...")
        for year in r2_years:
            print(f"  R2 year {year}:")
            fleet, vr_prov = _get_fleet_for_year(year)
            if fleet is None or fleet.empty:
                fleet = legacy_fleet_df
            tracts_data, tracts_byFuel = compute_hourly_emissions(
                state, year, fleet, models, manifest=None
            )
            if tracts_data is None:
                if 2024 in yearly_data:
                    print(f"    -> Reusing 2024 data for {year}")
                    tracts_data = yearly_data[2024]
                    tracts_byFuel = yearly_byFuel[2024]
                    year_provenance[str(year)] = {"traffic": "copied_from_2024"}
                else:
                    continue
            else:
                year_provenance[str(year)] = {"traffic": "legacy"}
            yearly_data[year] = tracts_data
            yearly_byFuel[year] = tracts_byFuel
            all_tracts.update(tracts_data.keys())

    if not yearly_data:
        return None

    FUEL_METRIC_KEYS = ["Gasoline", "Diesel", "Electricity", "Ethanol", "CNG"]
    EMISSION_KEYS = ["CO2", "NOx", "PM2.5B", "PM2.5T"]

    emission_units = {
        "CO2": "CO\u2082 (ton)",
        "NOx": "NO\u2093 (kg)",
        "PM2.5B": "PM2.5 Brakes (gm)",
        "PM2.5T": "PM2.5 Tires (gm)",
    }

    # Build R2: for each tract, sum daily (25 hourly values) for each year
    r2 = {}
    for metric_key, unit in metric_units.items():
        tracts = {}
        for tract_id in sorted(all_tracts):
            annual_values = []
            for year in r2_years:
                if year in yearly_data and tract_id in yearly_data[year]:
                    daily_total = sum(yearly_data[year][tract_id][metric_key])
                    annual_total = daily_total * 365  # Scale daily to annual
                    annual_values.append(round(annual_total, 6))
                else:
                    annual_values.append(0.0)
            tracts[tract_id] = annual_values
        r2[metric_key] = {"labels": labels, "unit": unit, "tracts": tracts}

    # Per-fuel emission breakdowns for R2
    by_fuel = {}
    for fk in FUEL_METRIC_KEYS:
        by_fuel[fk] = {}
        for ek in EMISSION_KEYS:
            tracts = {}
            for tract_id in sorted(all_tracts):
                annual_values = []
                for year in r2_years:
                    if year in yearly_byFuel and tract_id in yearly_byFuel[year]:
                        daily_total = sum(yearly_byFuel[year][tract_id][fk][ek])
                        annual_total = daily_total * 365
                        annual_values.append(round(annual_total, 6))
                    else:
                        annual_values.append(0.0)
                tracts[tract_id] = annual_values
            by_fuel[fk][ek] = {"labels": labels, "unit": emission_units[ek], "tracts": tracts}
    r2["byFuel"] = by_fuel

    # Meta block with provenance
    r2["meta"] = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "state": state,
        "yearRange": [r2_years[0], r2_years[-1]],
        "anchorYears": abm_anchor_years,       # backward compat alias
        "abmAnchorYears": abm_anchor_years,
        "vrAnchorYears": vr_anchor_years,
        "yearProvenance": year_provenance,
        "hasManifest": manifest is not None,
        "modelingAssumptions": [
            "VR fleet: interpolated/extrapolated linearly between VR anchor years by vehicle count per (vehicle_type, fuel_type, age). Fractions recomputed from blended counts.",
            "ABM traffic: interpolated/extrapolated linearly between ABM anchor years. Speed and volume clamped >= 0.",
            "Single-anchor fallback: when only one upload exists, data is reused as-is (labeled 'constant').",
        ],
    }

    return r2


def verify_consistency(json_data, label):
    """Verify that per-fuel emission sums match aggregate totals."""
    by_fuel = json_data.get("byFuel")
    if not by_fuel:
        print(f"  [SKIP] No byFuel data in {label}")
        return

    EMISSION_KEYS = ["CO2", "NOx", "PM2.5B", "PM2.5T"]
    FUEL_KEYS = list(by_fuel.keys())
    all_pass = True

    for ek in EMISSION_KEYS:
        agg = json_data.get(ek)
        if not agg:
            continue
        for tract_id, agg_vals in agg["tracts"].items():
            for t_idx in range(len(agg_vals)):
                fuel_sum = sum(
                    by_fuel[fk][ek]["tracts"].get(tract_id, [0] * (t_idx + 1))[t_idx]
                    for fk in FUEL_KEYS
                    if fk in by_fuel and ek in by_fuel[fk]
                )
                diff = abs(fuel_sum - agg_vals[t_idx])
                if diff > 0.01:  # R2 amplifies rounding (25h × 365d)
                    print(f"  [FAIL] {label} {ek} tract={tract_id} t={t_idx}: "
                          f"fuel_sum={fuel_sum:.6f} != agg={agg_vals[t_idx]:.6f} (diff={diff:.6f})")
                    all_pass = False

    print(f"  [{'PASS' if all_pass else 'FAIL'}] {label} byFuel consistency check")


# ── Public API for endpoint use ─────────────────────────────────────────────

def generate_for_state(state, output_dir=None):
    """Generate R1 and R2 JSON for a single state. Returns dict with results info.
    This is the entry point used by the /api/generate-results endpoint."""
    if output_dir is None:
        output_dir = DEFAULT_OUTPUT_DIR

    result = {"state": state, "r1": None, "r2": None, "errors": []}

    # Load manifest
    manifest = load_manifest(state)
    if manifest:
        anchors = get_anchor_years(manifest)
        print(f"  Manifest found: anchors={anchors}, "
              f"baseYear={manifest.get('baseYear')}, endYear={manifest.get('endYear')}")
    else:
        print(f"  No manifest — using legacy file scan")

    # Load fleet and models
    print(f"  Loading vehicle fleet...")
    vr_anchors = get_vr_anchor_years(manifest)
    base_year = manifest.get("baseYear", 2024) if manifest else 2024

    # Pre-load VR anchor fleets for R1 resolution
    vr_fleet_cache = {}
    for vy in vr_anchors:
        f = get_vehicle_fleet(vy)
        vr_fleet_cache[vy] = f if not f.empty else None

    # For R1: resolve VR fleet for the base year using interpolation/extrapolation
    if vr_anchors:
        fleet_df, r1_vr_prov = interpolate_fleet(base_year, vr_anchors, vr_fleet_cache)
        if fleet_df is not None and not fleet_df.empty:
            vr_src = r1_vr_prov.get("vrSource", "")
            anchors_str = ",".join(str(a) for a in r1_vr_prov.get("vrAnchors", []))
            print(f"  R1 fleet: vrSource={vr_src}, anchors=[{anchors_str}]")
        else:
            fleet_df = get_vehicle_fleet(2024)
            print(f"  No usable VR data, falling back to BaseYear=2024")
    else:
        fleet_df = get_vehicle_fleet(2024)
        print(f"  No VR uploads in manifest, using legacy BaseYear=2024")

    if fleet_df.empty:
        result["errors"].append("No vehicle fleet data found in database")
        return result
    print(f"  {len(fleet_df)} vehicle-fuel combos, {fleet_df['count'].sum()} total vehicles")

    print(f"  Loading models for {state}...")
    models = {}
    try:
        for key in ["CO2", "Energy", "NOx", "PM25Brake", "PM25Tire"]:
            models[key] = load_model_checkpoint(state, key)
    except FileNotFoundError as e:
        result["errors"].append(str(e))
        return result

    os.makedirs(output_dir, exist_ok=True)

    # R1: Use base year from manifest or 2024
    print(f"\n  Generating R1 (daily hourly) for base year {base_year}...")
    tracts_data, tracts_byFuel = compute_hourly_emissions(
        state, base_year, fleet_df, models, manifest=manifest
    )

    if tracts_data:
        r1 = build_r1_json(tracts_data, tracts_byFuel)
        verify_consistency(r1, f"{state}_R1")
        r1_path = os.path.join(output_dir, f"{state}_R1.json")
        with open(r1_path, "w", encoding="utf-8") as f:
            json.dump(r1, f, ensure_ascii=False)
        print(f"  -> Saved {r1_path} ({len(tracts_data)} tracts)")
        result["r1"] = r1_path
    else:
        msg = f"SKIPPED R1 (no traffic data for {base_year})"
        print(f"  -> {msg}")
        result["errors"].append(msg)

    # R2: Annual data across dynamic year range (per-year fleet resolution)
    print(f"\n  Generating R2 (annual)...")
    r2 = build_r2_json(state, models, manifest=manifest, legacy_fleet_df=fleet_df)
    if r2:
        verify_consistency(r2, f"{state}_R2")
        r2_path = os.path.join(output_dir, f"{state}_R2.json")
        with open(r2_path, "w", encoding="utf-8") as f:
            json.dump(r2, f, ensure_ascii=False)
        print(f"  -> Saved {r2_path}")
        result["r2"] = r2_path
    else:
        msg = "SKIPPED R2 (no traffic data)"
        print(f"  -> {msg}")
        result["errors"].append(msg)

    return result


# ── CLI ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Generate R1/R2 JSON files")
    parser.add_argument("--state", type=str, help="Single state to generate (e.g. GA)")
    parser.add_argument("--output-dir", type=str, help="Output directory for JSON files")
    args = parser.parse_args()

    states = [args.state] if args.state else STATES
    output_dir = args.output_dir or DEFAULT_OUTPUT_DIR

    for state in states:
        print(f"\n{'='*60}")
        print(f"Generating R1/R2 for {state}")
        print(f"{'='*60}")
        generate_for_state(state, output_dir)

    print("\nDone! R1/R2 JSON files regenerated with MOVES5 models.")


if __name__ == "__main__":
    main()
