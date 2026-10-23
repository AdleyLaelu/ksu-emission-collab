"""
Fix MOVES5 data inflation by extracting population factors.

MOVES5 CSVs were exported in Inventory mode (population-weighted totals)
instead of Rate mode (per-vehicle rates), causing ~70x inflation.

This script:
1. Computes population factors by comparing MOVES5 vs MOVES4 CO2 values
   (CO2 is proportional to fuel carbon content, stable between MOVES versions)
2. For each (vehicleType, fuelType, age) combo, the median CO2 ratio across
   speeds approximates the population factor
3. Divides all 5 emission columns by the population factor
4. Saves corrected CSVs that train_moves5.py can use

Usage:
    python fix_moves5_data.py
"""

import os
import pandas as pd
import numpy as np

# ── Paths ────────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(SCRIPT_DIR)

MOVES5_DIR = os.path.join(REPO_DIR, "..", "Emission 1", "MOVES 5 Emission data")
MOVES4_DIR = os.path.join(REPO_DIR, "documents", "Fig 2")
CORRECTED_DIR = os.path.join(REPO_DIR, "Emission 1 corrected", "MOVES 5 Emission data")

# ── ID mappings (same as train_moves5.py) ────────────────────────────────────
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
SPEED_BIN_MAP = {
    1: 2.5, 2: 5, 3: 10, 4: 15, 5: 20, 6: 25, 7: 30, 8: 35,
    9: 40, 10: 45, 11: 50, 12: 55, 13: 60, 14: 65, 15: 70, 16: 75,
}

# State-specific MOVES4 CO2 file names
MOVES4_CO2_FILES = {
    "GA": "2024GeorgiaMovesData_sorted_above_CO2.csv",
    "CA": "2024CaliforniaMovesData_sorted_above_CO2.csv",
    "NY": "2024NewYorkMovesData_sorted_above_CO2.csv",
    "WA": "2024WashingtonMovesdata_sorted_above_CO2.csv",
}

EMISSION_COLS = ["NOx", "CO2", "Total Energy", "PM2.5 Brakewear", "PM2.5 Tirewear"]
STATES = ["CA", "GA", "NY", "WA"]


def load_moves5(state: str) -> pd.DataFrame:
    path = os.path.join(MOVES5_DIR, f"Emissions_Output_{state}.csv")
    df = pd.read_csv(path)
    df["Vehicle Type"] = df["VehicleID"].map(VEHICLE_MAP)
    df["Fuel Type"] = df["fuelTypeID"].map(FUEL_MAP)
    df["Speed_mph"] = df["speed"].map(SPEED_BIN_MAP)
    df["Age"] = df["age"]
    return df


def load_moves4_co2(state: str) -> pd.DataFrame:
    filename = MOVES4_CO2_FILES[state]
    path = os.path.join(MOVES4_DIR, state, "Data", filename)
    return pd.read_csv(path)


def compute_population_factors(m5: pd.DataFrame, m4: pd.DataFrame, state: str) -> pd.DataFrame:
    """Compute population factors per (Vehicle Type, Fuel Type, Age).

    Uses median CO2 ratio across speeds as the population factor estimate.
    CO2 is proportional to fuel carbon content and is stable between MOVES
    versions, so MOVES5_CO2 / MOVES4_CO2 ≈ PopulationFactor.
    """
    merged = m5.merge(
        m4,
        left_on=["Vehicle Type", "Fuel Type", "Age", "Speed_mph"],
        right_on=["Vehicle Type", "Fuel Type", "Age", "Speed"],
        suffixes=("_m5", "_m4"),
    )
    # Only use rows with positive CO2 in both datasets
    merged = merged[(merged["CO2_m4"] > 0) & (merged["CO2_m5"] > 0)]
    merged["ratio"] = merged["CO2_m5"] / merged["CO2_m4"]

    # Median ratio per (Vehicle Type, Fuel Type, Age)
    factors = (
        merged.groupby(["Vehicle Type", "Fuel Type", "Age"])["ratio"]
        .median()
        .reset_index()
        .rename(columns={"ratio": "pop_factor"})
    )

    print(f"\n  {state}: Computed {len(factors)} population factors")
    print(f"    Factor range: {factors['pop_factor'].min():.1f} - {factors['pop_factor'].max():.1f}")
    print(f"    Median factor: {factors['pop_factor'].median():.1f}")

    # Summary by vehicle type
    vt_summary = factors.groupby("Vehicle Type")["pop_factor"].median()
    for vt, f in vt_summary.items():
        print(f"    {vt}: {f:.1f}")

    return factors


def apply_corrections(m5: pd.DataFrame, factors: pd.DataFrame, state: str) -> pd.DataFrame:
    """Divide emission columns by population factors to get per-vehicle rates."""
    df = m5.copy()

    # Merge factors
    df = df.merge(
        factors,
        on=["Vehicle Type", "Fuel Type", "Age"],
        how="left",
    )

    # For rows without a factor (e.g., Electric vehicles not in MOVES4),
    # use median factor for that Vehicle Type across all fuel types/ages
    missing = df["pop_factor"].isna()
    if missing.any():
        vt_median = factors.groupby("Vehicle Type")["pop_factor"].median()
        for vt, med in vt_median.items():
            mask = missing & (df["Vehicle Type"] == vt)
            df.loc[mask, "pop_factor"] = med

    # If still missing (shouldn't happen), use overall median
    still_missing = df["pop_factor"].isna()
    if still_missing.any():
        df.loc[still_missing, "pop_factor"] = factors["pop_factor"].median()
        print(f"  WARNING: {still_missing.sum()} rows used overall median factor")

    n_corrected = (~missing).sum()
    n_fallback = missing.sum()
    print(f"  {state}: {n_corrected} rows with exact factors, {n_fallback} rows with fallback factors")

    # Divide emission columns by population factor
    for col in EMISSION_COLS:
        if col in df.columns:
            df[col] = df[col] / df["pop_factor"]

    return df


def save_corrected(df: pd.DataFrame, state: str):
    """Save corrected CSV with original column structure."""
    os.makedirs(CORRECTED_DIR, exist_ok=True)
    out_path = os.path.join(CORRECTED_DIR, f"Emissions_Output_{state}.csv")

    # Keep only original columns
    original_cols = ["fuelTypeID", "VehicleID", "speed", "age"] + EMISSION_COLS
    df[original_cols].to_csv(out_path, index=False)
    print(f"  Saved: {out_path}")
    return out_path


def validate_corrections(df_corrected: pd.DataFrame, m4: pd.DataFrame, state: str):
    """Spot-check corrected values against MOVES4."""
    df = df_corrected.copy()
    df["Vehicle Type"] = df["VehicleID"].map(VEHICLE_MAP)
    df["Fuel Type"] = df["fuelTypeID"].map(FUEL_MAP)
    df["Speed_mph"] = df["speed"].map(SPEED_BIN_MAP)
    df["Age"] = df["age"]

    merged = df.merge(
        m4,
        left_on=["Vehicle Type", "Fuel Type", "Age", "Speed_mph"],
        right_on=["Vehicle Type", "Fuel Type", "Age", "Speed"],
        suffixes=("_corrected", "_m4"),
    )
    merged = merged[(merged["CO2_m4"] > 0) & (merged["CO2_corrected"] > 0)]

    if len(merged) == 0:
        print(f"  {state}: No overlapping data for validation")
        return

    merged["pct_diff"] = ((merged["CO2_corrected"] - merged["CO2_m4"]) / merged["CO2_m4"]) * 100

    print(f"\n  {state} validation (corrected vs MOVES4 CO2):")
    print(f"    Median % difference: {merged['pct_diff'].median():.1f}%")
    print(f"    Mean abs % difference: {merged['pct_diff'].abs().mean():.1f}%")
    print(f"    95th percentile abs diff: {merged['pct_diff'].abs().quantile(0.95):.1f}%")

    # Spot checks
    checks = [
        ("Passenger Car", "Gasoline", 5, 20.0),
        ("School Bus", "Diesel Fuel", 25, 2.5),
        ("Combination Long-haul Truck", "Diesel Fuel", 10, 55.0),
    ]
    for vt, ft, age, spd in checks:
        row = merged[
            (merged["Vehicle Type"] == vt)
            & (merged["Fuel Type"] == ft)
            & (merged["Age"] == age)
            & (merged["Speed_mph"] == spd)
        ]
        if len(row) > 0:
            r = row.iloc[0]
            print(
                f"    {vt}/{ft} age={age} spd={spd}: "
                f"corrected={r['CO2_corrected']:.1f}, "
                f"MOVES4={r['CO2_m4']:.1f}, "
                f"diff={r['pct_diff']:.1f}%"
            )


def main():
    print("=" * 70)
    print("Fixing MOVES5 data inflation by extracting population factors")
    print("=" * 70)

    for state in STATES:
        print(f"\n{'-' * 60}")
        print(f"Processing {state}")
        print(f"{'-' * 60}")

        # Load data
        m5 = load_moves5(state)
        m4 = load_moves4_co2(state)
        print(f"  Loaded MOVES5: {len(m5)} rows, MOVES4: {len(m4)} rows")

        # Compute population factors from CO2 ratios
        factors = compute_population_factors(m5, m4, state)

        # Apply corrections
        df_corrected = apply_corrections(m5, factors, state)

        # Save corrected CSV
        save_corrected(df_corrected, state)

        # Validate
        validate_corrections(df_corrected, m4, state)

    print(f"\n{'=' * 70}")
    print("Done! Corrected CSVs saved to:")
    print(f"  {CORRECTED_DIR}")
    print("\nNext step: update train_moves5.py MOVES5_DIR to point to corrected data,")
    print("then run: python train_moves5.py")


if __name__ == "__main__":
    main()
