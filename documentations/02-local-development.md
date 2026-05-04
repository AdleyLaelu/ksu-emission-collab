# 02 — Local Development

This is what you do on your laptop to get the app running, edit code, and verify changes before pushing.

## Prerequisites

- **Python 3.11** (the `Dockerfile` pins this; 3.10 and 3.12 also work locally but I haven't tested 3.13)
- **Node.js 22** (the frontend `Dockerfile` pins `node:22-alpine`)
- **Docker Desktop** if you want to run the integrated stack
- ~2 GB free disk (PyTorch CPU wheel + node_modules)

## Two ways to run

### Option A — Native (recommended for development)

Faster iteration, hot reload on both ends. This is what I used day-to-day.

**Backend:**

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install --index-url https://download.pytorch.org/whl/cpu torch
pip install -r requirements.txt
python run.py            # serves on http://0.0.0.0:5003 with use_reloader=True
```

The CPU-only torch wheel saves ~2 GB vs. the default. `requirements.txt` does not pin versions, so a fresh install will pull whatever is current. If a transformer pickle fails to load due to sklearn version drift, see [05-deployment.md](05-deployment.md) for the `add_safe_globals` workaround.

**Frontend:**

```bash
cd frontend
npm install              # ~3 minutes the first time
npm run dev              # serves on http://localhost:5173
```

The Vite dev server proxies nothing by default. The frontend reads the API base URL from `import.meta.env.VITE_API_URL`, falling back to `http://localhost:5003` (see [src/config.js](../frontend/src/config.js)). For local dev you can leave `VITE_API_URL` unset.

CORS is wide open on the backend (`CORS(app)` with no origin restriction), so the React dev server on `:5173` calling `:5003` Just Works.

### Option B — Docker Compose

Use this when you want to test what actually ships, or to verify nginx routing.

```bash
docker compose up --build
```

- Frontend: http://localhost (port 80)
- Backend health: http://localhost/health (proxied through nginx)

Rebuilds are slow because the backend image installs torch + scientific Python from scratch each time. Use `docker compose up backend` if you only changed Python, or `--no-deps frontend` if you only changed React.

`docker compose down -v` will also drop the named volume `db-data`, wiping the DB. `docker compose down` (no `-v`) preserves it.

## Environment variables

There are two `.env` concepts and they are easy to confuse.

### Project root `.env` — for `deploy.sh`

```
EC2_HOST=<ip>
EC2_KEY=traffic-emission-key.pem
EC2_USER=ec2-user
EC2_APP_DIR=/home/ec2-user/app
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_DEFAULT_REGION=us-east-2
```

This is read by `deploy.sh` only. It has nothing to do with the running app. Template at `.env.example`.

### Runtime env vars

The app reads exactly one env var:

- `DB_FILE` — path to the SQLite file. Defaults to `prediction.db` (relative to the working directory). Docker overrides this to `/app/db/prediction.db`.

Frontend reads:

- `VITE_API_URL` — bakes into the Vite build. Defaults to `http://localhost:5003`. The Docker frontend build sets it to `""` so the browser hits same-origin (nginx).

## Common dev workflows

### "I just want to test a prediction"

With backend running on `:5003`:

```bash
curl -X POST http://localhost:5003/predict_emissions \
  -H 'Content-Type: application/json' \
  -d '{
    "City": "Atlanta",
    "FuelType": "Gasoline",
    "VehicleType": "Passenger Car",
    "Age": 5,
    "EmissionType": "CO2 Emissions"
  }'
```

You'll get back an array of 71 rows (one per speed 0..70). See [04-api-reference.md](04-api-reference.md) for every endpoint.

### "I want to test a fresh upload flow"

Sample files live at:

- `backend/sample_traffic_volume.csv`
- `backend/sample_vehicle_data.csv`
- `input-files/` (more variety)
- Postman collections: `backend/postman_collection*.json` import these into Postman for one-click testing of every route.

### "I changed the SQL schema"

The schema is created in `init_db()` in [run.py](../backend/run.py). It uses `CREATE TABLE IF NOT EXISTS`, so changes to existing tables are silently ignored. Either:

- Delete `backend/prediction.db` and restart (works locally; loses all data).
- Manually run `ALTER TABLE` against the live DB if you need to preserve data.

There are no migrations. Adopt a tool (alembic, sqlite-utils) if this becomes a real problem.

### "I changed a model checkpoint"

Drop the new `.pth` file in `backend/models/<STATE>/` matching the existing naming pattern (`best_model_<STATE><KIND>.pth`). Make sure the input feature count matches the table in [01-architecture.md](01-architecture.md) — if not, update `feature_map_all` in `load_state_models` (in `run.py`) accordingly. Restart the backend to pick up the change.

### "I broke the DB"

```bash
rm backend/prediction.db
python run.py    # init_db() recreates it
```

For Docker:

```bash
docker compose down -v   # -v drops the db-data volume
docker compose up --build
```

## Linting and formatting

- Frontend: `npm run lint` (ESLint flat config in `frontend/eslint.config.js`). Not enforced anywhere.
- Backend: there is no linter or formatter configured. I'd add `ruff` and `black` if I were staying.

## Git hygiene

- Default branch: `main`. Direct commits to `main` are common — no branch protection, no PR template.
- Recent feature work has come through PRs (`#15`, `#16`, `#17`) but not consistently.
- The repo is private (`git@github.com:Anphamthanh/ksu-emission-collab.git`). It has commits with `prediction.db` and a `.pem` file in history — be careful before any public mirror.

## Things that will trip you up

- **`backend/app.py` is dead code**. It is a smaller, older Flask app that gunicorn does not import. The Dockerfile says `gunicorn ... run:app`. Editing `app.py` will appear to do nothing.
- **`schema.py` is empty** (0 bytes). Don't import from it.
- **The DB volume in Docker masks the in-image DB**. If you `COPY` an updated `prediction.db` into the image but keep the volume mounted, you will not see your update in production — the volume's old DB shadows the new one. You have to remove the volume (`docker volume rm <project>_db-data`) on the EC2 host or copy the new DB into the volume manually. I've been bitten by this twice.
- **PyTorch 2.6 changed unpickling defaults** (`weights_only=True`). All `torch.load` calls in this codebase now have a fallback to `weights_only=False`. If a new sklearn class shows up in a checkpoint and refuses to load, add it to the `add_safe_globals(...)` list at the top of `run.py`.
- **The frontend's `__MACOSX/` directory** in `frontend/src/` is the residue of an unzipped archive. Safe to delete; I never got around to it.
