"""
Tests for GridEmissions JSON data integrity.

Run: python test_grid_emissions.py
"""

import json, sys, os
from pathlib import Path

FRONTEND_R1R2 = Path(__file__).resolve().parent.parent / "frontend" / "src" / "assets" / "r1r2data"

EXPECTED_YEARS = ["2025", "2026", "2027", "2028", "2029", "2030"]
EXPECTED_GASES = ["CO2", "CH4", "N2O"]
EXPECTED_SCENARIOS = [
    "Mid-case Scenario",
    "Low Renewable Energy and Battery Costs",
    "High Renewable Energy and Battery Costs",
    "High Demand Growth",
    "Low Natural Gas Prices",
    "High Natural Gas Prices",
    "Low RE & Battery Costs + High Gas Prices",
    "High RE & Battery Costs + Low Gas Prices",
]

failures = []


def fail(msg):
    failures.append(msg)
    print(f"  FAIL: {msg}")


def test_file_exists_for_states_with_data():
    """GA and CA should have GridEmissions files; NY and WA should not."""
    for state in ["GA", "CA"]:
        path = FRONTEND_R1R2 / f"{state}_GridEmissions.json"
        if not path.exists():
            fail(f"{state}_GridEmissions.json missing")
    for state in ["NY", "WA"]:
        path = FRONTEND_R1R2 / f"{state}_GridEmissions.json"
        if path.exists():
            fail(f"{state}_GridEmissions.json should not exist (no R2 data)")


def test_json_structure(state):
    """Verify JSON has correct top-level structure."""
    path = FRONTEND_R1R2 / f"{state}_GridEmissions.json"
    if not path.exists():
        fail(f"{state}: file missing")
        return None
    with open(path) as f:
        data = json.load(f)
    if "meta" not in data:
        fail(f"{state}: missing 'meta' key")
    if "scenarios" not in data:
        fail(f"{state}: missing 'scenarios' key")
        return None
    return data


def test_scenarios_complete(state, data):
    """All 8 scenarios must be present."""
    scenarios = list(data["scenarios"].keys())
    for s in EXPECTED_SCENARIOS:
        if s not in scenarios:
            fail(f"{state}: missing scenario '{s}'")


def test_gases_and_labels(state, data):
    """Each scenario must have CO2, CH4, N2O with correct labels."""
    for scenario in data["scenarios"]:
        for gas in EXPECTED_GASES:
            gas_data = data["scenarios"][scenario].get(gas)
            if gas_data is None:
                fail(f"{state}/{scenario}: missing gas '{gas}'")
                continue
            if gas_data.get("labels") != EXPECTED_YEARS:
                fail(f"{state}/{scenario}/{gas}: labels != {EXPECTED_YEARS}, got {gas_data.get('labels')}")
            if "studyAreaTotal" not in gas_data:
                fail(f"{state}/{scenario}/{gas}: missing 'studyAreaTotal'")
            if "tracts" not in gas_data:
                fail(f"{state}/{scenario}/{gas}: missing 'tracts'")
            if "unit" not in gas_data:
                fail(f"{state}/{scenario}/{gas}: missing 'unit'")


def test_no_2024(state, data):
    """2024 must not appear in any labels array."""
    for scenario in data["scenarios"]:
        for gas in EXPECTED_GASES:
            labels = data["scenarios"][scenario].get(gas, {}).get("labels", [])
            if "2024" in labels:
                fail(f"{state}/{scenario}/{gas}: 2024 found in labels")


def test_summation_consistency(state, data):
    """studyAreaTotal must equal sum of tract values for each year."""
    for scenario in data["scenarios"]:
        for gas in EXPECTED_GASES:
            gas_data = data["scenarios"][scenario].get(gas)
            if not gas_data:
                continue
            tracts = gas_data.get("tracts", {})
            sat = gas_data.get("studyAreaTotal", [])
            for yr_idx in range(len(EXPECTED_YEARS)):
                tract_sum = sum(tracts[t][yr_idx] for t in tracts)
                if abs(tract_sum - sat[yr_idx]) > 0.01:
                    fail(f"{state}/{scenario}/{gas}/{EXPECTED_YEARS[yr_idx]}: "
                         f"tract_sum={tract_sum:.6f} != studyAreaTotal={sat[yr_idx]:.6f}")


def test_nonempty_data(state, data):
    """studyAreaTotal values must not all be zero for states with data."""
    for scenario in data["scenarios"]:
        for gas in EXPECTED_GASES:
            sat = data["scenarios"][scenario].get(gas, {}).get("studyAreaTotal", [])
            if all(v == 0 for v in sat):
                fail(f"{state}/{scenario}/{gas}: all studyAreaTotal values are zero")


def test_positive_values(state, data):
    """All emission values should be non-negative."""
    for scenario in data["scenarios"]:
        for gas in EXPECTED_GASES:
            gas_data = data["scenarios"][scenario].get(gas)
            if not gas_data:
                continue
            for v in gas_data.get("studyAreaTotal", []):
                if v < 0:
                    fail(f"{state}/{scenario}/{gas}: negative studyAreaTotal value {v}")
            for t, vals in gas_data.get("tracts", {}).items():
                for v in vals:
                    if v < 0:
                        fail(f"{state}/{scenario}/{gas}/tract {t}: negative value {v}")


def test_import_pattern_no_require():
    """GridEmissionsChart.jsx must use ES import, not require()."""
    chart_path = Path(__file__).resolve().parent.parent / "frontend" / "src" / "components" / "GridEmissionsChart.jsx"
    if not chart_path.exists():
        fail("GridEmissionsChart.jsx not found")
        return
    content = chart_path.read_text()
    if "require(" in content:
        fail("GridEmissionsChart.jsx uses require() — Vite needs ES import")
    if "import GA_GridEmissions" not in content:
        fail("GridEmissionsChart.jsx missing static import for GA_GridEmissions")
    if "import CA_GridEmissions" not in content:
        fail("GridEmissionsChart.jsx missing static import for CA_GridEmissions")


def test_finalresults_import_pattern():
    """FinalResultsPage.jsx must use ES import for GridEmissions, not require()."""
    page_path = Path(__file__).resolve().parent.parent / "frontend" / "src" / "components" / "FinalResultsPage.jsx"
    if not page_path.exists():
        fail("FinalResultsPage.jsx not found")
        return
    content = page_path.read_text()
    if "require(" in content and "GridEmissions" in content:
        # Check specifically for require() of GridEmissions files
        for line in content.split("\n"):
            if "require(" in line and "GridEmissions" in line:
                fail(f"FinalResultsPage.jsx uses require() for GridEmissions: {line.strip()}")


def main():
    print("Running GridEmissions data integrity tests...\n")

    # Test 1: File existence
    print("1. File existence...")
    test_file_exists_for_states_with_data()

    # Test 2: Import pattern (prevent Vite/require regression)
    print("2. Import patterns (no require())...")
    test_import_pattern_no_require()
    test_finalresults_import_pattern()

    # Tests 3-8: Data integrity per state
    for state in ["GA", "CA"]:
        print(f"\n3-8. Data integrity for {state}...")
        data = test_json_structure(state)
        if data is None:
            continue
        test_scenarios_complete(state, data)
        test_gases_and_labels(state, data)
        test_no_2024(state, data)
        test_summation_consistency(state, data)
        test_nonempty_data(state, data)
        test_positive_values(state, data)

    print(f"\n{'='*50}")
    if failures:
        print(f"FAILED: {len(failures)} failure(s)")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print("ALL TESTS PASSED")
        sys.exit(0)


if __name__ == "__main__":
    main()
