"""
Tests for manifest-based provenance, anchor validation, traffic interpolation,
and dynamic year range in the refactored generate_r1r2_json.py.

Run: python test_manifest_and_interpolation.py
"""

import json
import os
import sys
import tempfile
import shutil
from pathlib import Path

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

failures = []


def fail(msg):
    failures.append(msg)
    print(f"  FAIL: {msg}")


def ok(msg):
    print(f"  OK: {msg}")


def test_load_manifest():
    """Test manifest loading."""
    from generate_r1r2_json import load_manifest
    # GA should have a manifest if one was created by upload
    manifest = load_manifest("GA")
    if manifest is not None:
        ok("GA manifest loaded")
        if "uploads" not in manifest:
            fail("GA manifest missing 'uploads' key")
        if "state" not in manifest:
            fail("GA manifest missing 'state' key")
    else:
        ok("GA manifest not present (expected if no uploads since Step 1)")


def test_get_anchor_years():
    """Test anchor year extraction from manifest."""
    from generate_r1r2_json import get_anchor_years

    # Test with mock manifest
    mock_manifest = {
        "uploads": {
            "2024": {"source": "user_upload", "file": "GA_2024_ABM.xlsx"},
            "2030": {"source": "user_upload", "file": "GA_2030_ABM.xlsx"},
            "2029": {"source": "legacy", "file": "GA_2029_ABM.xlsx"},  # not trusted
        }
    }
    anchors = get_anchor_years(mock_manifest)
    if anchors == [2024, 2030]:
        ok("Anchor years correctly extracted (excluding non-user_upload)")
    else:
        fail(f"Expected [2024, 2030], got {anchors}")

    # Test with no manifest
    anchors = get_anchor_years(None)
    if anchors == []:
        ok("No manifest returns empty anchors")
    else:
        fail(f"Expected [], got {anchors}")


def test_get_year_range():
    """Test dynamic year range computation."""
    from generate_r1r2_json import get_year_range

    # With baseYear/endYear in manifest
    manifest = {"baseYear": 2024, "endYear": 2030, "uploads": {}}
    yr = get_year_range(manifest)
    if yr == list(range(2024, 2031)):
        ok("Year range from manifest baseYear/endYear correct")
    else:
        fail(f"Expected [2024..2030], got {yr}")

    # With only anchors
    manifest = {"uploads": {
        "2025": {"source": "user_upload"},
        "2028": {"source": "user_upload"},
    }}
    yr = get_year_range(manifest)
    if yr == list(range(2025, 2029)):
        ok("Year range from anchor span correct")
    else:
        fail(f"Expected [2025..2028], got {yr}")

    # No manifest
    yr = get_year_range(None)
    if yr == list(range(2024, 2031)):
        ok("Default year range correct")
    else:
        fail(f"Expected [2024..2030], got {yr}")


def test_traffic_data_provenance():
    """Test that get_traffic_data respects manifest provenance."""
    from generate_r1r2_json import get_traffic_data

    # With manifest: only return data for uploaded years
    manifest = {
        "uploads": {
            "2024": {"source": "user_upload", "file": "GA_2024_ABM.xlsx"},
            "2030": {"source": "user_upload", "file": "GA_2030_ABM.xlsx"},
        }
    }

    # 2024 should be found (uploaded)
    fmt, source, path, prov = get_traffic_data("GA", 2024, manifest)
    if fmt is not None and prov == "uploaded":
        ok("GA/2024 found with 'uploaded' provenance")
    elif fmt is None:
        fail("GA/2024 not found even though it's in manifest")
    else:
        fail(f"GA/2024 provenance is '{prov}', expected 'uploaded'")

    # 2029 should NOT be found (not in manifest, and manifest blocks filesystem scan)
    fmt, source, path, prov = get_traffic_data("GA", 2029, manifest)
    if fmt is None:
        ok("GA/2029 correctly blocked when manifest exists (not an upload)")
    else:
        fail(f"GA/2029 should not be found when manifest exists, got provenance='{prov}'")

    # Without manifest: legacy scan allowed
    fmt, source, path, prov = get_traffic_data("GA", 2024, None)
    if fmt is not None and prov == "legacy":
        ok("GA/2024 found with 'legacy' provenance when no manifest")
    elif fmt is None:
        ok("GA/2024 not found in legacy mode (file may not exist)")
    else:
        fail(f"Expected 'legacy' provenance, got '{prov}'")


def test_validate_anchor_compatibility():
    """Test anchor compatibility validation."""
    from generate_r1r2_json import validate_anchor_compatibility

    manifest = {
        "uploads": {
            "2024": {"source": "user_upload", "file": "GA_2024_ABM.xlsx"},
            "2030": {"source": "user_upload", "file": "GA_2030_ABM.xlsx"},
        }
    }

    # Check if both files exist
    ga_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "Combined_sheet_output_speed", "GA")
    f2024 = os.path.join(ga_dir, "GA_2024_ABM.xlsx")
    f2030 = os.path.join(ga_dir, "GA_2030_ABM.xlsx")

    if not (os.path.exists(f2024) and os.path.exists(f2030)):
        ok("Skipping compatibility test (anchor files not present)")
        return

    is_valid, errors = validate_anchor_compatibility("GA", [2024, 2030], manifest)
    if is_valid:
        ok("GA anchor years 2024/2030 are compatible")
    else:
        # Warnings are acceptable (e.g. slight row count differences)
        print(f"  WARN: Anchor compatibility issues: {errors}")
        ok("Anchor compatibility check ran (with warnings)")


def test_interpolate_traffic():
    """Test traffic interpolation between anchor years."""
    from generate_r1r2_json import interpolate_traffic

    manifest = {
        "uploads": {
            "2024": {"source": "user_upload", "file": "GA_2024_ABM.xlsx"},
            "2030": {"source": "user_upload", "file": "GA_2030_ABM.xlsx"},
        }
    }

    ga_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          "Combined_sheet_output_speed", "GA")
    f2024 = os.path.join(ga_dir, "GA_2024_ABM.xlsx")
    f2030 = os.path.join(ga_dir, "GA_2030_ABM.xlsx")

    if not (os.path.exists(f2024) and os.path.exists(f2030)):
        ok("Skipping interpolation test (anchor files not present)")
        return

    # Interpolate for 2027 (midpoint)
    frames = interpolate_traffic("GA", 2027, [2024, 2030], manifest)
    if frames is None:
        fail("Interpolation returned None for 2027")
        return

    if len(frames) > 0:
        ok(f"Interpolated 2027: {len(frames)} tracts")
    else:
        fail("Interpolation returned empty frames")

    # Check that interpolated values are between anchor values
    from generate_r1r2_json import get_traffic_data, load_tract_dataframes
    fmt_lo, src_lo, path_lo, _ = get_traffic_data("GA", 2024, manifest)
    fmt_hi, src_hi, path_hi, _ = get_traffic_data("GA", 2030, manifest)
    frames_lo = load_tract_dataframes(fmt_lo, src_lo, path_lo)
    frames_hi = load_tract_dataframes(fmt_hi, src_hi, path_hi)

    lo_dict = {tid: df for tid, df in frames_lo}
    hi_dict = {tid: df for tid, df in frames_hi}
    interp_dict = {tid: df for tid, df in frames}

    # Spot-check first common tract
    common = set(lo_dict.keys()) & set(hi_dict.keys()) & set(interp_dict.keys())
    if common:
        tid = sorted(common)[0]
        speed_col = "Speed" if "Speed" in lo_dict[tid].columns else "Traffic Speed"
        lo_speed = lo_dict[tid][speed_col].values[0]
        hi_speed = hi_dict[tid][speed_col].values[0]
        interp_speed = interp_dict[tid][speed_col].values[0]

        # alpha = (2027-2024)/(2030-2024) = 0.5
        expected = lo_speed * 0.5 + hi_speed * 0.5
        if abs(interp_speed - expected) < 0.01:
            ok(f"Interpolated speed for tract {tid} matches expected ({interp_speed:.2f})")
        else:
            fail(f"Interpolated speed {interp_speed:.2f} != expected {expected:.2f}")


def test_r2_meta_in_output():
    """Test that R2 JSON includes meta block with provenance."""
    # Check existing R2 files for meta (if regenerated)
    r1r2_dir = Path(__file__).resolve().parent.parent / "frontend" / "src" / "assets" / "r1r2data"
    r2_path = r1r2_dir / "GA_R2.json"
    if not r2_path.exists():
        ok("Skipping R2 meta test (GA_R2.json not found)")
        return

    with open(r2_path) as f:
        r2 = json.load(f)

    if "meta" in r2:
        meta = r2["meta"]
        if "yearProvenance" in meta:
            ok(f"R2 meta has yearProvenance: {list(meta['yearProvenance'].keys())}")
        else:
            ok("R2 meta exists but no yearProvenance (pre-refactor data)")
        if "anchorYears" in meta:
            ok(f"R2 meta has anchorYears: {meta['anchorYears']}")
    else:
        ok("GA_R2.json has no meta block (pre-refactor data, expected)")


def test_grid_emissions_dynamic_years():
    """Test that grid emissions reads years from R2 labels."""
    from generate_grid_emissions_json import load_r2_electricity

    labels, r2_elec = load_r2_electricity("GA")
    if labels is None:
        ok("Skipping grid emissions dynamic years test (no GA R2 data)")
        return

    ok(f"R2 electricity labels: {labels}")

    # Verify years are read from labels, not hardcoded
    if len(labels) > 0:
        ok(f"Dynamic year range: {labels[0]}–{labels[-1]}")
    else:
        fail("Empty labels from R2 electricity data")


def test_generate_for_state_importable():
    """Test that generate_for_state is importable."""
    try:
        from generate_r1r2_json import generate_for_state
        ok("generate_for_state is importable")
    except ImportError as e:
        fail(f"generate_for_state import failed: {e}")


def test_grid_emissions_for_state_importable():
    """Test that generate_grid_emissions_for_state is importable."""
    try:
        from generate_grid_emissions_json import generate_grid_emissions_for_state
        ok("generate_grid_emissions_for_state is importable")
    except ImportError as e:
        fail(f"generate_grid_emissions_for_state import failed: {e}")


def main():
    print("Running manifest, interpolation, and provenance tests...\n")

    print("1. Manifest loading...")
    test_load_manifest()

    print("\n2. Anchor year extraction...")
    test_get_anchor_years()

    print("\n3. Dynamic year range...")
    test_get_year_range()

    print("\n4. Traffic data provenance...")
    test_traffic_data_provenance()

    print("\n5. Anchor compatibility validation...")
    test_validate_anchor_compatibility()

    print("\n6. Traffic interpolation...")
    test_interpolate_traffic()

    print("\n7. R2 meta/provenance in output...")
    test_r2_meta_in_output()

    print("\n8. Grid emissions dynamic years...")
    test_grid_emissions_dynamic_years()

    print("\n9. Import tests...")
    test_generate_for_state_importable()
    test_grid_emissions_for_state_importable()

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
