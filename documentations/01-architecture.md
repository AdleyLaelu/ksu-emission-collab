# 01 — Architecture

## High-level picture

```
┌────────────────────────┐         ┌──────────────────────────┐
│ Browser (React + Vite) │ HTTP/8x │ nginx (frontend container)│
│  Tailwind, Zustand,    ├────────►│  serves /dist, proxies    │
│  Chart.js, MUI, etc.   │         │  /predict_*  /process/*   │
└────────────────────────┘         │  /upload/*   /plot/*      │
                                   │  /admin/*    /auth/*      │
                                   └────────────┬─────────────┘
                                                │ proxy_pass
                                                ▼
                                   ┌──────────────────────────┐
                                   │ Flask + gunicorn (5003)  │
                                   │  run.py (entry)          │
                                   │  traffic_processor.py    │
                                   │  abm_data_loader.py      │
                                   │  traffic_plotter.py      │
                                   │  models.py (ModifiedNet) │
                                   └──┬─────────┬─────────┬──┘
                                      │         │         │
                                  SQLite     PyTorch    Excel files
                                  prediction  models/   Combined_sheet_*
                                  .db        ml_models/
```

There are no message queues, no Redis, no Celery, no auth provider. It is a single Python process behind gunicorn behind nginx, and a SQLite file on disk. Keep it that simple unless you have a real reason not to.

## Service topology (Docker Compose)

`docker-compose.yml` defines two services:

- `backend` — image built from `backend/Dockerfile`; gunicorn binds `0.0.0.0:5003`; mounts a named volume `db-data` to `/app/db` so the SQLite DB survives container rebuilds. Health check: `curl -f http://localhost:5003/health`.
- `frontend` — image built from `frontend/Dockerfile` (multi-stage: `node:22-alpine` build → `nginx:alpine` runtime). Publishes port 80. Depends on `backend`. The nginx config proxies a fixed list of paths to `backend:5003`; everything else falls through to `index.html` for client-side routing.

The frontend container speaks to the backend by container name (`backend:5003`) over the default Docker network. There is no exposed backend port to the host — all traffic enters through nginx on port 80.

## End-to-end data flow

The UI is a 3-step wizard (`ArrowStepper.jsx`): Input → Analysis → Results.

### Step 1 — Input Data (sub-stepper)

1. **Vehicle Classification Data** — user uploads a CSV/Excel with `(City, Vehicle Type, Fuel Type, Vehicle Count, Age)`. Frontend POSTs to `/upload/vehicle_classification` (multipart). Backend renames columns, attaches the global transaction_id, writes to `vehicle_classification_data` table.
2. **Projected Vehicle Penetration Rate Data** — same shape; goes to `/upload/penetration_rate` → `penetration_rate_data` table.
3. **Traffic Volume and Speed** — branches on `trafficMode`:
   - `MFD` mode → `/upload/traffic_volume` (two files: traffic CSV + MFD parameters CSV) → `traffic_volume_data` + `mfd_params` tables.
   - `ABM` mode (Atlanta only) → uses the pre-computed ABM data shipped under `backend/atlanta_abm_data/year_<YEAR>/`. No upload required. The frontend calls `/process/traffic/abm` to materialize the per-tract Excel file the rest of the pipeline reads.
4. **Projected Demand** — uploads a master CSV + a detail file/JSON to `/upload/projected_traffic` → `projected_traffic_volume` + `projected_traffic_details`.

### Step 2 — Analysis

User picks fuel type, emission type, vehicle age, and grid emission options. The frontend calls:

- `/predict_emissions` for per-speed emission curves (CO2, NOx, PM2.5 brake, PM2.5 tire, energy rate). Backend loops speeds 0..70, runs the per-state PyTorch model, returns one row per speed.
- `/predict_consumption` for fuel consumption curves (computes kJ/mile from energy rate, divides by per-fuel kJ/unit, returns gallon/mile or kWh/mile per speed).

### Step 3 — Results

- **R1 / R2 charts** — vehicle-level emission and consumption curves (Chart.js).
- **R3 grid charts** — aggregated grid emission rates.
- **Interactive tract map** — `InteractiveTractMap.jsx` uses pre-rendered tract data; the backend exposes `/plot/traffic/data/<city>/<year>` returning JSON (time, speed, volume per tract) and `/plot/traffic/<city>/<year>` returning a matplotlib PNG.

## ML pipeline

### Model architecture

Two architectures coexist:

1. **`MLPRegressor`** (defined inline in both `app.py` and `run.py`): two hidden layers `(32, 16)` with ReLU, single scalar output. Used for the legacy `models[STATE][kind]` dict. Loads checkpoints from `backend/models/<STATE>/best_model_<STATE><KIND>.pth`.
2. **`ModifiedNet`** (defined in `backend/models.py`): the production architecture. Each checkpoint pickle bundles `{model_state_dict, preprocessor, target_scaler}`. The preprocessor is a sklearn `ColumnTransformer` with `StandardScaler` + `OneHotEncoder`; the target scaler is a `PowerTransformer`. This is what `predict_one(...)` and `/predict_emissions` actually use.

Both architectures are loaded at startup. The `predict_emissions` route calls `load_state_models(city_name)` per request, which reloads from disk every time. That is wasteful but tolerable at current traffic levels — if you scale, cache it.

### Per-state input feature counts

`load_state_models` hard-codes per-state, per-emission-type input feature dimensions:

| State | CO2 | Energy | NOx | PM25Brake | PM25Tire |
|------|-----|--------|-----|-----------|----------|
| CA | 19 | 20 | 19 | 20 | 20 |
| GA | 19 | 20 | 19 | 20 | 19 |
| NY | 18 | 19 | 18 | 19 | 19 |
| WA | 19 | 20 | 19 | 20 | 20 |

These came from how each model was trained (different states had slightly different one-hot expansion). If a checkpoint mismatch errors at load time, that table is the first place to look.

### Categories (must match training exactly)

`VEHICLE_CATS` (13 labels) and `FUEL_CATS` (5 labels) are hard-coded in `run.py`. **There is a typo in `run.py`'s VEHICLE_CATS**: it lists both `"Single Unit Long-haul Truck"` and `"Single Unit Short-haul Truck"` (uppercase S) and also `"Single Unit short-haul Truck"` (lowercase s) — the third entry is dead. Don't fix it without retraining or you'll break the one-hot vector alignment.

`CITY_TO_STATE` maps friendly city names to state codes: Atlanta→GA, Los Angeles/LosAngeles→CA, NewYork→NY, Seattle→WA. Missing cities default to GA in some code paths (`/predict_emissions`) and raise in others (`/process/traffic/abm/upload`). Inconsistent — consider unifying.

## ABM (Activity-Based Model) data — Atlanta only

`backend/atlanta_abm_data/year_<YEAR>/` ships pre-computed traffic volume + speed for 20 downtown Atlanta census tracts at five projection years: 2020, 2030, 2033, 2040, 2050. `abm_data_loader.py` exposes:

- `is_abm_available(city, year)` — bool gate
- `get_atlanta_tract_ids()` — the 20 tract IDs (zero-padded 11-digit FIPS strings)
- `process_abm_data_for_emissions(year)` — loads the year-specific data and returns `{tract_id: DataFrame}` with columns Time/Speed/Density/Volume
- `load_interpolated_data(year, tract_id)` — linear interpolation between the 5 anchor years for any in-range year

The output from `/process/traffic/abm` is written to `backend/Combined_sheet_output_speed/GA/GA_<YEAR>_ABM.xlsx` (or `..._interpolated.xlsx`). Subsequent `/plot/traffic/data/...` calls read from this file. The selection priority is `ABM Direct > ABM Interpolated > MFD`.

## Database schema

SQLite, file at `DB_FILE` (default `prediction.db`, overridden in Docker to `/app/db/prediction.db`). Schema is created lazily on first run by `init_db()` in `run.py`. Tables:

| Table | Purpose | Created by |
|-------|---------|------------|
| `users` | Login (admin/admin seed). Fake JWT — not real auth. | `init_db` |
| `vehicle_classification`, `vehicle_classification_data` | Two parallel tables for classification uploads. The `_data` variant is what the upload route writes. | `init_db` |
| `penetration_rate` | Penetration rate uploads | `init_db` |
| `traffic_volume`, `traffic_volume_data` | Same dual-table pattern as classification. `_data` is the live one. | `init_db` |
| `mfd_params` | MFD parameter rows (tract, param_key, param_value). Populated from melted user uploads. | `init_db` |
| `projected_traffic`, `projected_traffic_volume`, `projected_traffic_details` | Demand projections. The `_volume` and `_details` pair is what `/upload/projected_traffic` writes. | `init_db` |
| `results` | Stored emissions results for download via `/results/download`. Mostly unused — predictions are computed on demand. | `init_db` |

The schema is denormalized and has dead tables. Don't be surprised by it. If you need to reset, delete `prediction.db` and restart the backend; `init_db()` recreates everything and re-seeds the admin user.

## What's not here (and why it matters)

- **No real authentication.** `/auth/login` accepts admin/admin, returns the literal string `"fake-jwt"`. Don't expose this server publicly without putting real auth in front of it.
- **No tests.** Zero. There is a `backend/test_data/` folder (sample inputs) and Postman collections, but no pytest, no Jest. If you change behavior, exercise it manually through the UI or via curl/Postman.
- **No CI.** GitHub repo has no Actions. Deploys are manual via `deploy.sh`.
- **No migrations.** The DB schema lives in `init_db()`. Any change requires either a manual `ALTER TABLE` on the deployed DB or a destroy-and-recreate.
- **CORS is wide open** (`CORS(app)`). Fine for development; harden before any public deployment.
