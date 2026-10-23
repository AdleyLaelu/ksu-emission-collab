"""
Fix MOVES5 data inflation using ACTUAL population numbers from the MOVES5 default database.

The MOVES5 CSVs were exported in Inventory mode (population-weighted totals)
instead of Rate mode (per-vehicle rates). This script:

1. Extracts population data from the MOVES5 default database dump (EPA GitHub):
   - sourceTypeYear: national population per vehicle type per year
   - sourceTypeAgeDistribution: age fraction per vehicle type per year
   - sampleVehiclePopulation: fuel type fraction per vehicle type per model year
   - zone: county allocation factors (SHPAllocFactor)

2. Computes county-level population per (sourceType, fuelType, age):
   pop = nationalPop × ageFraction × fuelFraction × countyAllocFactor

3. Divides all emission columns by the population to get per-vehicle rates

4. Cross-checks corrected values against MOVES4 CO2 data for validation

Usage:
    python fix_moves5_with_population.py
"""

import os
import re
import pandas as pd
import numpy as np

# ── Paths ────────────────────────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(SCRIPT_DIR)

CYBER_DIR = os.path.dirname(REPO_DIR)  # CyberlawAndPolicy

SQL_FILE = os.path.join(
    CYBER_DIR, "EPA_MOVES_Model", "database", "Setup",
    "movesdb_extracted", "movesdb20241112.sql"
)
MOVES5_DIR = os.path.join(CYBER_DIR, "Emission 1", "MOVES 5 Emission data")
MOVES4_DIR = os.path.join(REPO_DIR, "documents", "Fig 2")
CORRECTED_DIR = os.path.join(REPO_DIR, "Emission 1 corrected", "MOVES 5 Emission data")

# ── ID mappings ──────────────────────────────────────────────────────────────
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

# Counties used for each state's MOVES5 run (FIPS codes)
COUNTY_FIPS = {
    "GA": 13121,  # Fulton County (Atlanta)
    "CA": 6037,   # Los Angeles County
    "NY": 36061,  # New York County (Manhattan)
    "WA": 53033,  # King County (Seattle)
}

# County allocation factors from MOVES5 zone table (SHPAllocFactor)
COUNTY_ALLOC = {
    "GA": 0.0043983111,
    "CA": 0.0273157966,
    "NY": 0.0008223791,
    "WA": 0.0048981253,
}

EMISSION_COLS = ["NOx", "CO2", "Total Energy", "PM2.5 Brakewear", "PM2.5 Tirewear"]
STATES = ["CA", "GA", "NY", "WA"]
BASE_YEAR = 2024

# MOVES4 CO2 reference files for validation
MOVES4_CO2_FILES = {
    "GA": "2024GeorgiaMovesData_sorted_above_CO2.csv",
    "CA": "2024CaliforniaMovesData_sorted_above_CO2.csv",
    "NY": "2024NewYorkMovesData_sorted_above_CO2.csv",
    "WA": "2024WashingtonMovesdata_sorted_above_CO2.csv",
}


def read_sql_lines(filepath, start_line, end_line):
    """Read specific line range from the SQL dump."""
    content = ""
    with open(filepath, "r", encoding="utf-8", errors="replace") as f:
        for i, line in enumerate(f, 1):
            if i >= start_line:
                content += line
            if i >= end_line:
                break
    return content


def extract_national_populations():
    """Extract national population per sourceType for BASE_YEAR from sourceTypeYear."""
    print("Extracting national populations from sourceTypeYear...")
    content = read_sql_lines(SQL_FILE, 7272509, 7273330)
    rows = re.findall(
        r"\((\d+),(\d+),([\d.eE+-]+),([\d.eE+-]+),([\d.eE+-]+)\)", content
    )
    nat_pop = {}
    for r in rows:
        yr, st = int(r[0]), int(r[1])
        if yr == BASE_YEAR:
            nat_pop[st] = float(r[3])
    print(f"  Found {len(nat_pop)} source types for year {BASE_YEAR}")
    for st_id in sorted(nat_pop):
        print(f"    {VEHICLE_MAP.get(st_id, st_id)}: {nat_pop[st_id]:,.0f}")
    return nat_pop


def extract_age_distribution():
    """Extract age fractions per (sourceType, age) for BASE_YEAR."""
    print("\nExtracting age distribution from sourceTypeAgeDistribution...")
    content = read_sql_lines(SQL_FILE, 7234700, 7268282)
    rows = re.findall(r"\((\d+),(\d+),(\d+),([\d.eE+-]+)\)", content)
    age_fracs = {}
    for r in rows:
        st, yr, age = int(r[0]), int(r[1]), int(r[2])
        if yr == BASE_YEAR and age <= 30:
            age_fracs[(st, age)] = float(r[3])
    print(f"  Found {len(age_fracs)} (sourceType, age) entries for year {BASE_YEAR}")
    return age_fracs


def extract_fuel_fractions():
    """Extract fuel type fractions per (sourceType, modelYear, fuelType)."""
    print("\nExtracting fuel fractions from sampleVehiclePopulation...")
    content = read_sql_lines(SQL_FILE, 7165050, 7181480)
    rows = re.findall(
        r"\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+),([\d.eE+-]+),([\d.eE+-]+)\)", content
    )
    print(f"  Raw rows: {len(rows)}")

    # Sum stmyFuelEngFraction per (sourceType, modelYear, fuelType)
    fuel_fracs = {}
    for r in rows:
        st, my, ft = int(r[1]), int(r[2]), int(r[3])
        frac = float(r[6])
        key = (st, my, ft)
        fuel_fracs[key] = fuel_fracs.get(key, 0) + frac

    # Filter for model years relevant to BASE_YEAR with ages 0-30
    relevant = {k: v for k, v in fuel_fracs.items()
                if BASE_YEAR - 30 <= k[1] <= BASE_YEAR}
    print(f"  Relevant (sourceType, modelYear, fuelType) entries: {len(relevant)}")
    return fuel_fracs


def compute_population_table(nat_pop, age_fracs, fuel_fracs):
    """Compute population per (sourceType, fuelType, age) for each state's county.

    Formula:
        pop(state, sourceType, fuelType, age) =
            nationalPop(sourceType) ×
            ageFraction(sourceType, age) ×
            fuelFraction(sourceType, modelYear=BASE_YEAR-age, fuelType) ×
            countyAllocFactor(state)
    """
    print("\nComputing county-level population table...")
    records = []

    for state, alloc in COUNTY_ALLOC.items():
        for st_id, st_name in VEHICLE_MAP.items():
            n_pop = nat_pop.get(st_id, 0)
            if n_pop == 0:
                continue

            for age in range(31):
                age_frac = age_fracs.get((st_id, age), 0)
                if age_frac == 0:
                    continue

                model_year = BASE_YEAR - age

                for ft_id, ft_name in FUEL_MAP.items():
                    fuel_frac = fuel_fracs.get((st_id, model_year, ft_id), 0)
                    if fuel_frac == 0:
                        continue

                    population = n_pop * age_frac * fuel_frac * alloc
                    records.append({
                        "state": state,
                        "sourceTypeID": st_id,
                        "fuelTypeID": ft_id,
                        "age": age,
                        "Vehicle Type": st_name,
                        "Fuel Type": ft_name,
                        "population": population,
                    })

    df = pd.DataFrame(records)
    print(f"  Total records: {len(df)}")

    # Summary per state
    for state in STATES:
        state_df = df[df["state"] == state]
        total = state_df["population"].sum()
        print(f"\n  {state} total county population: {total:,.0f}")
        for st_id in sorted(VEHICLE_MAP):
            st_pop = state_df[state_df["sourceTypeID"] == st_id]["population"].sum()
            if st_pop > 0:
                print(f"    {VEHICLE_MAP[st_id]}: {st_pop:,.1f}")

    return df


def load_moves5(state):
    """Load original (inflated) MOVES5 emission data."""
    path = os.path.join(MOVES5_DIR, f"Emissions_Output_{state}.csv")
    df = pd.read_csv(path)
    df["Vehicle Type"] = df["VehicleID"].map(VEHICLE_MAP)
    df["Fuel Type"] = df["fuelTypeID"].map(FUEL_MAP)
    df["Speed_mph"] = df["speed"].map(SPEED_BIN_MAP)
    df["Age"] = df["age"]
    return df


def load_moves4_co2(state):
    """Load MOVES4 CO2 reference data for validation."""
    filename = MOVES4_CO2_FILES[state]
    path = os.path.join(MOVES4_DIR, state, "Data", filename)
    if not os.path.exists(path):
        print(f"  WARNING: MOVES4 file not found: {path}")
        return None
    return pd.read_csv(path)


def apply_corrections(m5, pop_table, state):
    """Divide emission columns by population to get per-vehicle rates."""
    df = m5.copy()

    # Get population for this state
    state_pop = pop_table[pop_table["state"] == state][
        ["fuelTypeID", "sourceTypeID", "age", "population"]
    ].copy()

    # Merge population into emission data
    df = df.merge(
        state_pop,
        left_on=["fuelTypeID", "VehicleID", "age"],
        right_on=["fuelTypeID", "sourceTypeID", "age"],
        how="left",
    )

    # Report missing populations
    missing = df["population"].isna() | (df["population"] == 0)
    if missing.any():
        missing_combos = df[missing][["Vehicle Type", "Fuel Type", "age"]].drop_duplicates()
        print(f"  WARNING: {len(missing_combos)} (vehicleType, fuelType, age) combos"
              f" with no population ({missing.sum()} rows)")

        # Fallback: use median population for that sourceType across all fuel/ages
        for st_id in df[missing]["VehicleID"].unique():
            st_median = state_pop[state_pop["sourceTypeID"] == st_id]["population"].median()
            if pd.notna(st_median) and st_median > 0:
                mask = missing & (df["VehicleID"] == st_id)
                df.loc[mask, "population"] = st_median

    # If still missing, use overall median
    still_missing = df["population"].isna() | (df["population"] == 0)
    if still_missing.any():
        overall_median = state_pop["population"].median()
        df.loc[still_missing, "population"] = overall_median
        print(f"  WARNING: {still_missing.sum()} rows used overall median ({overall_median:.1f})")

    n_exact = (~missing).sum()
    n_fallback = missing.sum()
    print(f"  {state}: {n_exact} rows with exact population, {n_fallback} rows with fallback")

    # Divide emission columns by population
    for col in EMISSION_COLS:
        if col in df.columns:
            df[col] = df[col] / df["population"]

    return df


def save_corrected(df, state):
    """Save corrected CSV with original column structure."""
    os.makedirs(CORRECTED_DIR, exist_ok=True)
    out_path = os.path.join(CORRECTED_DIR, f"Emissions_Output_{state}.csv")

    original_cols = ["fuelTypeID", "VehicleID", "speed", "age"] + EMISSION_COLS
    df[original_cols].to_csv(out_path, index=False)
    print(f"  Saved: {out_path}")
    return out_path


def validate_against_moves4(df_corrected, state):
    """Cross-check corrected values against MOVES4 CO2 data."""
    m4 = load_moves4_co2(state)
    if m4 is None:
        return

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

    merged["pct_diff"] = (
        (merged["CO2_corrected"] - merged["CO2_m4"]) / merged["CO2_m4"]
    ) * 100

    print(f"\n  {state} VALIDATION (corrected MOVES5 vs MOVES4 CO2):")
    print(f"    Median % difference: {merged['pct_diff'].median():.2f}%")
    print(f"    Mean abs % difference: {merged['pct_diff'].abs().mean():.2f}%")
    print(f"    95th percentile abs diff: {merged['pct_diff'].abs().quantile(0.95):.2f}%")
    print(f"    Max abs diff: {merged['pct_diff'].abs().max():.2f}%")

    # Spot checks
    checks = [
        ("Passenger Car", "Gasoline", 5, 20.0),
        ("Passenger Car", "Gasoline", 0, 55.0),
        ("School Bus", "Diesel Fuel", 25, 2.5),
        ("Combination Long-haul Truck", "Diesel Fuel", 10, 55.0),
        ("Motorcycle", "Gasoline", 5, 30.0),
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
                f"corrected={r['CO2_corrected']:.2f}, "
                f"MOVES4={r['CO2_m4']:.2f}, "
                f"diff={r['pct_diff']:.2f}%"
            )


def compare_with_old_method(df_new, state):
    """Compare new population-based correction with old ratio-based correction."""
    old_path = os.path.join(CORRECTED_DIR, f"Emissions_Output_{state}.csv")
    if not os.path.exists(old_path):
        print(f"  No old corrected file found for comparison")
        return

    old_df = pd.read_csv(old_path)
    new_df = df_new[["fuelTypeID", "VehicleID", "speed", "age"] + EMISSION_COLS].copy()

    merged = new_df.merge(
        old_df,
        on=["fuelTypeID", "VehicleID", "speed", "age"],
        suffixes=("_new", "_old"),
    )

    for col in ["CO2", "NOx", "Total Energy"]:
        old_col = f"{col}_old"
        new_col = f"{col}_new"
        if old_col in merged.columns and new_col in merged.columns:
            valid = (merged[old_col] > 0) & (merged[new_col] > 0)
            if valid.any():
                pct = ((merged.loc[valid, new_col] - merged.loc[valid, old_col])
                       / merged.loc[valid, old_col] * 100)
                print(f"    {col}: median diff = {pct.median():.2f}%, "
                      f"mean abs = {pct.abs().mean():.2f}%")


def main():
    print("=" * 70)
    print("Fixing MOVES5 data using ACTUAL population from MOVES5 default DB")
    print("=" * 70)

    # Step 1: Extract population data from MOVES5 database dump
    nat_pop = extract_national_populations()
    age_fracs = extract_age_distribution()
    fuel_fracs = extract_fuel_fractions()

    # Step 2: Compute county-level population table
    pop_table = compute_population_table(nat_pop, age_fracs, fuel_fracs)

    # Step 3: Apply corrections to each state
    for state in STATES:
        print(f"\n{'=' * 60}")
        print(f"Processing {state}")
        print(f"{'=' * 60}")

        # Load inflated MOVES5 data
        m5 = load_moves5(state)
        print(f"  Loaded MOVES5: {len(m5)} rows")

        # Compare with old correction (before overwriting)
        print(f"\n  Comparing new vs old correction method:")
        # Apply correction using real population numbers
        df_corrected = apply_corrections(m5, pop_table, state)

        compare_with_old_method(df_corrected, state)

        # Save corrected CSV
        save_corrected(df_corrected, state)

        # Validate against MOVES4
        validate_against_moves4(df_corrected, state)

    print(f"\n{'=' * 70}")
    print("Done! Corrected CSVs saved to:")
    print(f"  {CORRECTED_DIR}")
    print("\nPopulation data source: MOVES5 default database (EPA GitHub)")
    print("  sourceTypeYear → national population")
    print("  sourceTypeAgeDistribution → age fractions")
    print("  sampleVehiclePopulation → fuel type fractions")
    print("  zone → county allocation factors")


if __name__ == "__main__":
    main()
