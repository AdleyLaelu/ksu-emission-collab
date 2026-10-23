"""
Master pipeline: retrain models with AI feedback, validate, and regenerate
all pregenerated JSON data for the frontend.

Runs sequentially:
  1. train_with_feedback.py  — retrain with conservative feedback loop
  2. comprehensive_validation.py — validate and generate plots
  3. generate_all_predictions.py — regenerate pregenerated JSON
  4. generate_r1r2_json.py — regenerate R1/R2 JSON for frontend

Usage:
    cd backend && python run_full_pipeline.py
"""

import os
import sys
import subprocess
import time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

STEPS = [
    {
        "name": "Train with AI Feedback Loop",
        "script": "train_with_feedback.py",
        "description": "Retrain models with conservative upsampling feedback",
    },
    {
        "name": "Comprehensive Validation",
        "script": "comprehensive_validation.py",
        "description": "Validate all models and generate plots",
    },
    {
        "name": "Generate All Predictions",
        "script": "generate_all_predictions.py",
        "description": "Regenerate pregenerated JSON for frontend",
    },
    {
        "name": "Generate R1/R2 JSON",
        "script": "generate_r1r2_json.py",
        "description": "Regenerate R1/R2 JSON for frontend charts",
    },
]


def run_step(step, step_num, total):
    script_path = os.path.join(BASE_DIR, step["script"])
    if not os.path.exists(script_path):
        print(f"  WARNING: {script_path} not found, skipping")
        return False

    print(f"\n{'='*70}")
    print(f"  STEP {step_num}/{total}: {step['name']}")
    print(f"  {step['description']}")
    print(f"  Script: {step['script']}")
    print(f"{'='*70}\n")

    start = time.time()
    result = subprocess.run(
        [sys.executable, script_path],
        cwd=BASE_DIR,
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
    )
    elapsed = time.time() - start
    minutes = int(elapsed // 60)
    seconds = int(elapsed % 60)

    if result.returncode != 0:
        print(f"\n  FAILED: {step['script']} exited with code {result.returncode}")
        print(f"  Elapsed: {minutes}m {seconds}s")
        return False

    print(f"\n  Completed: {step['script']} ({minutes}m {seconds}s)")
    return True


def main():
    print("=" * 70)
    print("  FULL PIPELINE: Train -> Validate -> Generate")
    print("=" * 70)

    total_start = time.time()
    total = len(STEPS)
    failed = []

    for i, step in enumerate(STEPS, 1):
        ok = run_step(step, i, total)
        if not ok:
            failed.append(step["name"])
            print(f"\n  Pipeline stopping due to failure in step {i}.")
            break

    total_elapsed = time.time() - total_start
    total_min = int(total_elapsed // 60)
    total_sec = int(total_elapsed % 60)

    print(f"\n{'='*70}")
    if failed:
        print(f"  PIPELINE FINISHED WITH ERRORS")
        print(f"  Failed steps: {', '.join(failed)}")
    else:
        print(f"  PIPELINE COMPLETED SUCCESSFULLY")
    print(f"  Total time: {total_min}m {total_sec}s")
    print(f"{'='*70}")

    print(f"\n  Verification checklist:")
    print(f"  1. Check training_feedback_log.csv — flagged combos should decrease")
    print(f"  2. Check validation_report.txt — no new flagged combos")
    print(f"  3. Check model_validation_plots/comprehensive/ — plots show good fit")
    print(f"  4. Restart backend (run.py) and verify UI charts")

    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
