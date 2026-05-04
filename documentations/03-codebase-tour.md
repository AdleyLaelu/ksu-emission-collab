# 03 — Codebase Tour

A tour of every directory and the files you'll actually open. "Skip" means it's safe to ignore unless you're doing something specific.

## Project root

```
traffic-emission-collab/
├── backend/                # Flask + ML
├── frontend/               # React + Vite SPA
├── documents/              # Research artifacts (PRD-style mockups, papers)
├── documentations/         # ← you are here
├── input-files/            # Sample CSV/Excel for end-to-end testing
├── poster/                 # Academic poster materials
├── docker-compose.yml      # Two-service stack: backend + frontend
├── deploy.sh               # rsync + remote `docker compose` to EC2
├── .env.example            # Template for deploy.sh config
├── .env                    # Real deploy config (git-ignored)
└── traffic-emission-key.pem # SSH key for EC2 (do not commit)
```

## Backend (`backend/`)

Flask + PyTorch. Single-process, gunicorn-served. ~2700 LOC of Python.

### Entry points and core

| File | LOC | What it does |
|------|-----|------|
| [run.py](../backend/run.py) | 1520 | **The app.** All routes, DB init, model loading, prediction logic. The Dockerfile runs `gunicorn run:app`. Start here. |
| [app.py](../backend/app.py) | 238 | **Dead code.** Older minimal Flask app with only `/predict/{co2,energy,nox,brake,tire}`. Not served. Don't edit. |
| [run.py:init_db](../backend/run.py#L44) | — | Lazy-creates all SQLite tables on import. Idempotent. |
| [Dockerfile](../backend/Dockerfile) | — | Python 3.11-slim, installs CPU torch separately to skip the 2GB CUDA wheel, runs `gunicorn --bind 0.0.0.0:5003 --timeout 120 run:app`. |

### ML and data processing

| File | LOC | What it does |
|------|-----|------|
| [models.py](../backend/models.py) | 20 | Defines `ModifiedNet`, the production model architecture. Used by `load_model(...)` in `run.py` to deserialize per-state checkpoints. |
| [traffic_processor.py](../backend/traffic_processor.py) | 433 | The MFD (Macroscopic Fundamental Diagram) traffic analysis. Solves the MFD equations from user-uploaded `λ, v_f, Q_m, k_j, w` parameters and traffic volumes, writes per-tract Excel sheets. Called by `/process/traffic`. |
| [abm_data_loader.py](../backend/abm_data_loader.py) | 285 | Atlanta-only Activity-Based Model data loading and per-year linear interpolation. Called by `/process/traffic/abm`. |
| [traffic_plotter.py](../backend/traffic_plotter.py) | 130 | Server-side matplotlib plot generation for `/plot/traffic/<city>/<year>`. The frontend prefers the JSON endpoint for client-side Chart.js rendering, so this is rarely hit. |
| [add_data.py](../backend/add_data.py) | 55 | One-off CLI helper to bulk-load data into the DB. Not wired to any route. |
| [schema.py](../backend/schema.py) | 0 | Empty. Don't import. |

### Model checkpoints (binary, not editable)

| Path | What |
|------|------|
| [models/CA/](../backend/models/CA/), `models/GA/`, `models/NY/`, `models/WA/` | Per-state PyTorch checkpoints. Five per state: `best_model_<STATE>{CO2,Energy,NOx,PM25Brake,PM25Tire}.pth`. Each is a dict `{model_state_dict, preprocessor, target_scaler}`. **This is the production set.** |
| [ml_models/](../backend/ml_models/) | Legacy directory with a duplicate set of CA + GA-only checkpoints. Loaded at module import as the global `models = {"gaCo2": ...}` dict. Kept around for the `predict_one(..., models=models)` calls that don't pass a state-specific dict. |

If you train a new model, put it in `models/<STATE>/`. The legacy `ml_models/` set should eventually be deleted.

### Reference data

| Path | What |
|------|------|
| [atlanta_abm_data/year_2020/](../backend/atlanta_abm_data/year_2020/), `year_2030/`, `year_2033/`, `year_2040/`, `year_2050/` | Pre-computed ABM traffic volume + speed for 20 Atlanta census tracts at five projection years. |
| [Combined_sheet_Input_volume/](../backend/Combined_sheet_Input_volume/), `Combined_sheet_output_speed/` | Working directories for the MFD/ABM processing pipeline. The `output_speed/<STATE>/<STATE>_<YEAR>{,_ABM,_ABM_interpolated}.xlsx` files are read back by `/plot/traffic/data/...`. Treated as cache. |
| [test_data/](../backend/test_data/), `vehicle_data.csv`, `vehicle_data.json`, `sample_*.csv` | Input fixtures for manual testing. |
| [prediction.db](../backend/prediction.db) | The SQLite database, committed to the repo (intentionally — it has the seed admin user and any data already loaded). Mounted-over by Docker volume in production. |
| `*.postman_collection*.json` | Postman collections for hitting every endpoint. Three flavors (full, GA-only, base). Import into Postman for one-click testing. |

## Frontend (`frontend/`)

Vite SPA, React 19, Tailwind 4, Zustand, MUI, Chart.js. ~30 component files.

### Top of the tree

| File | What |
|------|------|
| [src/main.jsx](../frontend/src/main.jsx) | React entry point. |
| [src/App.jsx](../frontend/src/App.jsx) | Layout shell: fixed Header (top), Footer (bottom), `<ArrowStepper>` as the only route. Theme is read from Zustand. |
| [src/config.js](../frontend/src/config.js) | One-liner: `export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:5003";`. Every fetch should use this. |
| [src/useAppStore.js](../frontend/src/useAppStore.js) | The single Zustand store. Holds every form's state (classification, penetration, traffic volume, projected demand, consumption, grid emission), notification list, theme, and the latest API request/response payloads for debugging. |
| [src/cityModel.ts](../frontend/src/cityModel.ts) | TypeScript types for city/model selection. |
| [vite.config.js](../frontend/vite.config.js) | Vite + React plugin, Tailwind. |
| [tailwind.config.js](../frontend/tailwind.config.js) | Tailwind 4 config. |
| [eslint.config.js](../frontend/eslint.config.js) | ESLint flat config. |
| [nginx.conf](../frontend/nginx.conf) | Production nginx config. SPA fallback to `index.html`, plus `proxy_pass` for `/health`, `/auth/`, `/admin/`, `/predict_emissions`, `/predict_consumption`, `/upload/`, `/process/`, `/results/`, `/plot/`. **Anything not in this list will not reach the backend in production.** |
| [Dockerfile](../frontend/Dockerfile) | Multi-stage: node:22 → npm ci → vite build → copy `/dist` into nginx:alpine. |

### Components (`src/components/`)

The 3-step wizard:

| Component | Role |
|-----------|------|
| [ArrowStepper.jsx](../frontend/src/components/ArrowStepper.jsx) | Top-level stepper. Tracks active step (Input / Analysis / Results), manages sub-steppers, owns gating logic. |
| [InputStepper.jsx](../frontend/src/components/InputStepper.jsx) | Sub-stepper for Step 1 (4 sub-steps). |
| [AnalysisStepper.jsx](../frontend/src/components/AnalysisStepper.jsx) | Sub-stepper for Step 2 (2 sub-steps). |
| [VerticalStepper.jsx](../frontend/src/components/VerticalStepper.jsx) | Vertical layout used inside specific input flows. |
| [ProgressBar.jsx](../frontend/src/components/ProgressBar.jsx) | The visual top bar. |

Step 1 input forms:

| Component | Role |
|-----------|------|
| [VehicleClassification.jsx](../frontend/src/components/VehicleClassification.jsx) | Upload + Handsontable preview of vehicle classification CSV. |
| [VehiclePenetration.jsx](../frontend/src/components/VehiclePenetration.jsx) | Same pattern for penetration rates. |
| [VehicleTrafficVolume.jsx](../frontend/src/components/VehicleTrafficVolume.jsx) | Branches on `trafficMode`. ABM path skips upload; MFD path takes two files. **This is the most-edited component recently** (see git log). |
| [ProjectedDemand.jsx](../frontend/src/components/ProjectedDemand.jsx) | Master CSV + detail file/JSON for projected demand. |
| [TractParametersTable.tsx](../frontend/src/components/TractParametersTable.tsx) | Editable per-tract MFD parameter grid. |
| [CitySelect.tsx](../frontend/src/components/CitySelect.tsx) | City dropdown bound to `CITY_TO_STATE`. |

Step 2 analysis:

| Component | Role |
|-----------|------|
| [EnergyConsumptionAndEmissionRates.jsx](../frontend/src/components/EnergyConsumptionAndEmissionRates.jsx) | Picks fuel type, emission type, vehicle age. Calls `/predict_emissions` and `/predict_consumption`. |
| [GridEmissionRates.jsx](../frontend/src/components/GridEmissionRates.jsx) | Grid emission options. |

Step 3 results:

| Component | Role |
|-----------|------|
| [FinalResultsPage.jsx](../frontend/src/components/FinalResultsPage.jsx) | Tabbed container for R1/R2/R3 results. |
| [VehicleChartR1R2.jsx](../frontend/src/components/VehicleChartR1R2.jsx) | Vehicle-level emission/consumption charts. |
| [GridChartR3.jsx](../frontend/src/components/GridChartR3.jsx) | Grid-level emission charts. |
| [TrafficChart.jsx](../frontend/src/components/TrafficChart.jsx) | Traffic volume/speed charts (data from `/plot/traffic/data/<city>/<year>`). |
| [InteractiveTractMap.jsx](../frontend/src/components/InteractiveTractMap.jsx) | Tract-level interactive map (per-tract drill-down). |
| [AnalysisImage.jsx](../frontend/src/components/AnalysisImage.jsx) | Wrapper for static analysis images. |

Chrome:

| Component | Role |
|-----------|------|
| [Header.jsx](../frontend/src/components/Header.jsx) | Top nav, theme toggle, notifications dropdown. |
| [Footer.jsx](../frontend/src/components/Footer.jsx) | Footer with sponsor logos (currently hidden per advisor request — see git log "hide footer logos"). |
| [Notifications.jsx](../frontend/src/components/Notifications.jsx) | In-app notification inbox (replaces Toaster, which is intentionally disabled — see App.jsx comment). |
| [SignIn.jsx](../frontend/src/components/SignIn.jsx), [SignUp.jsx](../frontend/src/components/SignUp.jsx) | Routed-but-disabled. Auth was scaffolded then commented out in `App.jsx`. |
| [temp.jsx](../frontend/src/components/temp.jsx) | Scratch file. Safe to delete. |

### Helpers

| Path | What |
|------|------|
| [src/api/prediction.ts](../frontend/src/api/prediction.ts) | A single typed wrapper for `/predict/by-model` (note: the route does not exist on the backend — this looks unused). |
| [src/lib/](../frontend/src/lib/) | Domain math: `compute-speed-table.js`, `derive-vehicle-weight.js`, `fetch-vehicle-weight.js`, `mfd.js`. |
| [src/utils/](../frontend/src/utils/) | UI helpers: `notify.js` (Zustand-backed toast), `chartConstants.js`, `analysisAssets.js`, `r3DataUtils.js`, etc. |
| [src/assets/](../frontend/src/assets/) | Logos, static images. |

## Documentation (`documents/`)

Not code — research-grade context from the GRA project.

- `Activity_Based_Model_Integration_Report.md` — the most useful, explains the ABM data integration that is now in `abm_data_loader.py`.
- `20250606_UI Mockup 1.pdf`, `TEEMAT_UI Version 2.pdf` — UI mockups the current design follows.
- `TRBAM-25-05721 1.pdf` — the TRB Annual Meeting paper submission. Useful for academic framing.
- `Fig 2/` — figure assets.

## Inputs (`input-files/`)

Sample input data organized by city/year for end-to-end testing. Use these to exercise the upload flows when the DB is empty.

## What I'd clean up if I were staying

1. Delete `backend/app.py` (dead code, confusing).
2. Delete `backend/schema.py` (empty file, confusing).
3. Delete `backend/ml_models/` after confirming nothing routes through the legacy global `models` dict.
4. Delete `frontend/src/__MACOSX/` (zip residue).
5. Delete `frontend/src/components/temp.jsx`.
6. Replace the `users`/`results`/`vehicle_classification`/`traffic_volume`/`projected_traffic` parallel-table mess with a single `_data` table per concept.
7. Add at least smoke tests for `/predict_emissions` and `/process/traffic/abm`.
