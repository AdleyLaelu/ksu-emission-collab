# Traffic Emission Collab — Onboarding

Welcome. This folder is the handoff package. Read it in order, ~30 minutes total.

## What this project is

A web application that predicts vehicle emissions (CO2, NOx, PM2.5 brake/tire wear) and energy consumption for four U.S. states (California, Georgia, New York, Washington) based on user-supplied vehicle classification, penetration, and traffic data. Results are visualized as charts and an interactive census-tract map.

The backend serves pre-trained PyTorch MLP regressors. The frontend is a multi-step wizard that collects inputs, calls the prediction API, and renders results.

The "GRA" parent project lives in [../../gra-traffic/](../../gra-traffic/); this `traffic-emission-collab/` is a fork used for collaboration with KSU. The two repos drift independently, so do not assume parity.

## Tech stack at a glance

| Layer     | Stack                                                                                         |
| --------- | --------------------------------------------------------------------------------------------- |
| Backend   | Python 3.11, Flask, gunicorn, PyTorch 2.x (CPU), scikit-learn, pandas, openpyxl, scipy        |
| Frontend  | React 19, Vite 6, Tailwind 4, MUI 7, Zustand, react-router-dom 7, Chart.js 4, Handsontable 15 |
| Database  | SQLite (`backend/prediction.db`)                                                              |
| Container | Docker + Docker Compose (`backend` + nginx-served `frontend`)                                 |
| Hosting   | AWS EC2 (Amazon Linux), shipped via `deploy.sh` (rsync + remote `docker compose`)             |

## Reading order

1. [01-architecture.md](01-architecture.md) — services, data flow, ML pipeline, DB schema. Read this before touching code.
2. [02-local-development.md](02-local-development.md) — getting it running on your laptop in ~10 minutes.
3. [03-codebase-tour.md](03-codebase-tour.md) — where every file lives and what it does.
4. [04-api-reference.md](04-api-reference.md) — every Flask endpoint, request and response shape.
5. [05-deployment.md](05-deployment.md) — EC2 deploy, env vars, the gotchas I hit in production.

## Key things you should know up-front

- **`backend/run.py` is the real app**, not `backend/app.py`. `app.py` is a legacy minimal Flask app that gunicorn does NOT serve. The Dockerfile runs `gunicorn ... run:app`. Don't waste time editing `app.py`.
- **Two model directories exist**: `backend/models/<STATE>/` (per-state, used by `load_state_models`) and `backend/ml_models/` (Georgia-only, legacy fallback used by the global `models = { "gaCo2": ... }` dict). Both are loaded at startup. New states should go in `backend/models/<STATE>/`.
- **Atlanta has a special data path** (Activity-Based Model, "ABM") with pre-computed traffic data for years 2020/2030/2033/2040/2050. Other cities fall back to the Macroscopic Fundamental Diagram (MFD) flow. The frontend calls `/process/traffic/abm` for Atlanta and `/process/traffic` otherwise.
- **A single global `transaction_id`** (`"emission-analysis-2025"`, defined in `run.py`) ties uploads together. There is no real per-user transaction logic. Don't assume multi-tenancy.
- **The DB ships in the repo** (`backend/prediction.db`). It is mounted into Docker at `/app/db/prediction.db` via a named volume, so the in-image copy is shadowed once the volume initializes. Read [05-deployment.md](05-deployment.md) for the implications.

## Where to find non-doc context

- `documents/` — research-paper-grade context: PRD-style UI mockups, the TRBAM submission, the ABM integration report. Skim once.
- `input-files/` — sample input CSVs/Excel files for testing uploads end-to-end.
- `poster/` — academic poster materials.
- `traffic-emission-key.pem` — SSH key for the EC2 box. **Do not commit, do not share, do not push to a public remote.** It is git-ignored (`.gitignore` covers it indirectly via permissions). The remote is `git@github.com:Anphamthanh/ksu-emission-collab.git` (private).
