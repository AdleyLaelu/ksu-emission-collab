"""
Generate EV-associated grid emissions JSON files.

Multiplies R2 annual electricity demand (MWh per tract) by R3 Cambium
marginal emission rates (annual average of 12 monthly rates) to produce
grid emissions in mass units (CO2 tons, CH4 grams, N2O grams).

Supports dynamic year ranges read from R2 JSON labels.

Output: frontend/src/assets/r1r2data/{STATE}_GridEmissions.json
   or:  backend/generated/{STATE}/{STATE}_GridEmissions.json
"""

import json, os, sys, math
from pathlib import Path

FRONTEND_R1R2 = Path(__file__).resolve().parent.parent / "frontend" / "src" / "assets" / "r1r2data"
FRONTEND_R3   = Path(__file__).resolve().parent.parent / "frontend" / "src" / "assets" / "r3data"

STATES = ["GA", "CA", "NY", "WA"]
GASES  = ["CO2", "CH4", "N2O"]

UNITS = {
    "CO2": "CO\u2082 (tons)",
    "CH4": "CH\u2084 (grams)",
    "N2O": "N\u2082O (grams)",
}

META = {
    "description": "EV-associated grid emissions: R2 electricity demand \u00d7 Cambium marginal rates",
    "energyBoundary": "MOVES Total Energy (LHV, kJ/mile) converted via 3600 kJ/kWh. Exact metering point (wheels, battery, or plug) unconfirmed.",
    "rateType": "Marginal emission rates from NREL Cambium 2024, Prophet-forecasted",
    "rateAveraging": "12-month arithmetic mean of monthly rates, assuming uniform monthly EV demand distribution",
    "limitations": [
        "2024 unavailable: Cambium data starts 2025",
        "Electricity demand is driving-hour energy, not charging-hour grid draw",
        "MOVES energy boundary for electricity unconfirmed (wheels vs battery vs plug)",
        "Uniform monthly demand assumption \u2014 no seasonal EV charging profile available",
        "Tract electricity estimates are provisional; lack lane-miles (Issue 1)",
    ],
}


def load_r2_electricity(state, r2_dir=None):
    """Load R2 JSON and return (years_list, {tract_id: {year: MWh}}).
    r2_dir overrides the default frontend assets path."""
    search_dir = Path(r2_dir) if r2_dir else FRONTEND_R1R2
    path = search_dir / f"{state}_R2.json"
    if not path.exists():
        return None, None
    with open(path) as f:
        r2 = json.load(f)
    elec = r2.get("Electricity")
    if not elec or not elec.get("tracts"):
        return None, None
    labels = elec["labels"]  # e.g. ["2024", "2025", ..., "2030"]
    tracts = elec["tracts"]
    if not tracts or all(len(v) == 0 for v in tracts.values()):
        return None, None
    result = {}
    for tract_id, values in tracts.items():
        result[tract_id] = {}
        for i, year in enumerate(labels):
            if i < len(values):
                result[tract_id][year] = values[i]
    return labels, result


def load_r3_rates(state, gas, years):
    """Load R3 JSON and return {scenario: {year: avg_rate}}.
    Only considers years in the provided years list."""
    path = FRONTEND_R3 / f"{state}_{gas}.json"
    if not path.exists():
        return None
    with open(path) as f:
        r3 = json.load(f)
    scenarios = r3.get("scenarios", {})
    result = {}
    years_set = set(years)
    for scenario_name, entries in scenarios.items():
        year_rates = {}
        for entry in entries:
            year = entry["date"][:4]
            if year not in years_set:
                continue
            year_rates.setdefault(year, []).append(entry["value"])
        # Compute annual average (arithmetic mean of 12 monthly rates)
        result[scenario_name] = {}
        for year in years:
            monthly = year_rates.get(year, [])
            if monthly:
                result[scenario_name][year] = sum(monthly) / len(monthly)
            else:
                result[scenario_name][year] = None
    return result


def generate_state(state, r2_dir=None):
    """Generate GridEmissions JSON for one state. Returns None if no data.
    r2_dir overrides where to look for R2 JSON."""
    labels, r2_elec = load_r2_electricity(state, r2_dir)
    if not r2_elec:
        print(f"  {state}: No R2 electricity data — skipping")
        return None

    # Determine years from R2 labels, excluding 2024 (Cambium starts 2025)
    years = [y for y in labels if y != "2024"]
    if not years:
        print(f"  {state}: No non-2024 years in R2 — skipping")
        return None

    tract_ids = sorted(r2_elec.keys())
    if not tract_ids:
        print(f"  {state}: No tracts — skipping")
        return None

    # Load R3 rates for all gases with dynamic years
    all_rates = {}
    for gas in GASES:
        rates = load_r3_rates(state, gas, years)
        if not rates:
            print(f"  {state}: No R3 data for {gas} — skipping state")
            return None
        all_rates[gas] = rates

    # Get scenario names from the first gas (they're the same across gases)
    scenario_names = list(all_rates[GASES[0]].keys())

    output = {"meta": META, "scenarios": {}}

    for scenario in scenario_names:
        output["scenarios"][scenario] = {}
        for gas in GASES:
            rates = all_rates[gas][scenario]
            tract_data = {}
            study_area_total = []

            for yr_idx, year in enumerate(years):
                avg_rate = rates.get(year)
                year_total = 0.0
                for tract_id in tract_ids:
                    elec_mwh = r2_elec[tract_id].get(year, 0.0)
                    if avg_rate is not None:
                        emission = elec_mwh * avg_rate
                    else:
                        emission = 0.0
                    tract_data.setdefault(tract_id, []).append(round(emission, 6))
                    year_total += emission
                study_area_total.append(round(year_total, 6))

            output["scenarios"][scenario][gas] = {
                "labels": list(years),
                "unit": UNITS[gas],
                "tracts": tract_data,
                "studyAreaTotal": study_area_total,
            }

    return output


def validate(state, output):
    """Run structural validation checks. Returns (pass_count, fail_count)."""
    passed = 0
    failed = 0

    for scenario_name, scenario_data in output["scenarios"].items():
        for gas in GASES:
            gas_data = scenario_data[gas]
            tracts = gas_data["tracts"]
            sat = gas_data["studyAreaTotal"]
            years = gas_data["labels"]

            for yr_idx, year in enumerate(years):
                # Summation consistency
                tract_sum = sum(tracts[t][yr_idx] for t in tracts)
                if abs(tract_sum - sat[yr_idx]) < 1e-4:
                    passed += 1
                else:
                    print(f"  FAIL summation: {scenario_name}/{gas}/{year}: "
                          f"tract_sum={tract_sum}, studyAreaTotal={sat[yr_idx]}")
                    failed += 1

    # Check 2024 is not in labels
    for scenario_name, scenario_data in output["scenarios"].items():
        for gas in GASES:
            if "2024" in scenario_data[gas]["labels"]:
                print(f"  FAIL: 2024 found in labels for {scenario_name}/{gas}")
                failed += 1
            else:
                passed += 1

    return passed, failed


def generate_grid_emissions_for_state(state, r2_dir=None, output_dir=None):
    """Public API for endpoint use. Generates and saves grid emissions JSON.
    Returns the output path or None."""
    output = generate_state(state, r2_dir=r2_dir)
    if output is None:
        return None

    p, f = validate(state, output)
    print(f"  Grid emissions validation: {p} passed, {f} failed")

    out_dir = Path(output_dir) if output_dir else FRONTEND_R1R2
    out_path = out_dir / f"{state}_GridEmissions.json"
    with open(out_path, "w") as fout:
        json.dump(output, fout, indent=2)
    print(f"  Written: {out_path}")
    return str(out_path)


def main():
    print("Generating EV-associated grid emissions JSON files...\n")

    for state in STATES:
        print(f"Processing {state}...")
        labels, r2_elec = load_r2_electricity(state)
        if not r2_elec:
            print(f"  {state}: No R2 electricity data — no output file\n")
            continue

        output = generate_state(state)
        if output is None:
            print()
            continue

        # Validate
        p, f = validate(state, output)
        print(f"  Validation: {p} passed, {f} failed")

        # Write output
        out_path = FRONTEND_R1R2 / f"{state}_GridEmissions.json"
        with open(out_path, "w") as fout:
            json.dump(output, fout, indent=2)
        print(f"  Written: {out_path}\n")

    print("Done.")


if __name__ == "__main__":
    main()
