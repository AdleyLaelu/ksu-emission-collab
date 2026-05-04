# 05 — Deployment and Operations

How this app gets to production, what can go wrong, and what to do about it.

## Where it runs

A single Amazon EC2 instance (Amazon Linux), Docker + Docker Compose, no load balancer, no autoscaling. The host runs both the `backend` and `frontend` containers. Port 80 is the only exposed port. There is no HTTPS — put CloudFront or a reverse proxy in front of it before exposing publicly.

## Configuration (your `.env` at project root)

`deploy.sh` reads:

```
EC2_HOST=<public-ip-or-dns>
EC2_KEY=traffic-emission-key.pem    # path relative to project root, or absolute
EC2_USER=ec2-user                   # default; AL2 uses ec2-user
EC2_APP_DIR=/home/ec2-user/app      # default
```

The key file is `traffic-emission-key.pem` at the project root, mode `0400`. It is not in git but it is on disk — guard it. If it ever leaks, rotate the key on AWS and reissue.

The `AWS_*` variables in `.env.example` are only needed if you provision new infrastructure (the original EC2 setup pre-dates this repo, so you probably won't need them).

## Deploying

Standard flow:

```bash
./deploy.sh
```

What it does:

1. Sources `.env`, validates `EC2_HOST` and `EC2_KEY`.
2. SSH-tests the connection.
3. `rsync -az --delete` the `frontend/` and `backend/` directories to `${EC2_APP_DIR}`. Excludes: `node_modules`, `.git`, `dist`, `__pycache__`, `.venv`.
4. `scp` the `docker-compose.yml`.
5. SSH-runs `docker compose build` on the EC2 host.
6. SSH-runs `docker compose down && docker compose up -d`.
7. Waits 5 seconds, hits `/health`.
8. Prints `docker ps`.

Useful flags:

| Flag | Effect |
|------|------|
| `--skip-sync` | Don't rsync. Use whatever is already on EC2. |
| `--skip-build` | Don't rebuild images. Just restart. |
| `--backend-only` | Sync/build/restart only the backend. |
| `--frontend-only` | Same for the frontend. |
| `--help` | Print usage. |

A full clean deploy on the existing EC2 instance takes ~5–8 minutes, dominated by the backend image rebuild (PyTorch + scientific Python).

## What the docker-compose.yml does on production

Same file as local. The only meaningful production-specific behavior is:

- `volumes: db-data:/app/db` — a named Docker volume holding `prediction.db`. **This volume shadows the `prediction.db` baked into the image.** First boot, the volume is empty and Docker copies the image's DB into it. Every subsequent rebuild ignores the image's DB.
- The frontend image is built with `VITE_API_URL=""` so the browser hits same-origin, and nginx proxies the `/predict_*`, `/upload/`, etc. paths to `backend:5003` over the Docker network.

## Common operations

### "I shipped a code change but the DB looks wrong"

Almost always the `db-data` volume issue above. To force-replace the production DB:

```bash
ssh -i traffic-emission-key.pem ec2-user@$EC2_HOST
cd ~/app
docker compose down
docker volume rm app_db-data        # name may be ${dir}_db-data; check `docker volume ls`
docker compose up -d
```

That copies the in-image DB into a fresh volume. Or skip the volume removal and `docker cp` the new file into the running container's `/app/db/`.

### "Backend won't start, says it can't load a model"

Two flavors:

1. **Pickling error mentioning a sklearn class.** PyTorch 2.6+ defaults to `weights_only=True` and refuses to unpickle arbitrary classes. The codebase has a try/except fallback, but if a brand-new sklearn class shows up, add it to the `add_safe_globals(...)` list at the top of `run.py`.
2. **Size mismatch error like `size mismatch for net.0.weight`.** The checkpoint's input feature count doesn't match what `load_state_models` expects. Cross-reference the per-state feature table in [01-architecture.md](01-architecture.md) and update `feature_map_all` in `run.py`.

### "Health check fails after deploy"

```bash
ssh -i traffic-emission-key.pem ec2-user@$EC2_HOST 'cd ~/app && docker compose logs --tail 200 backend'
```

The most common causes I hit:

- Old `prediction.db` schema doesn't match new code paths (run a manual `ALTER TABLE` or wipe the volume).
- Out-of-memory during gunicorn boot (the model loading is RAM-heavy on a t2.micro). Either upsize the instance or add lazy model loading.
- A model file is missing from `backend/models/<STATE>/`. Check `docker compose exec backend ls models/GA`.

### "I need to look at the live DB"

```bash
ssh -i traffic-emission-key.pem ec2-user@$EC2_HOST
docker compose exec backend sqlite3 /app/db/prediction.db
sqlite> .tables
sqlite> .schema vehicle_classification_data
sqlite> SELECT COUNT(*) FROM traffic_volume_data;
```

For a quick local copy of the live DB:

```bash
docker compose exec backend cat /app/db/prediction.db > /tmp/prod.db
# or
docker cp $(docker compose ps -q backend):/app/db/prediction.db ./prod.db
```

### "I need to deploy a model checkpoint without rebuilding everything"

Drop the new `.pth` into `backend/models/<STATE>/`, then:

```bash
./deploy.sh --backend-only
```

The rsync pushes the new checkpoint, the rebuild bakes it in, the restart loads it.

### "I want to change an environment variable"

The only runtime env var the app reads is `DB_FILE`, set in `docker-compose.yml`. To change it (or add new ones), edit `docker-compose.yml`, `scp` the file via `./deploy.sh` (which also handles it), and `docker compose up -d`. There is no separate `.env` for the running containers.

## Logging

Everything goes to stdout/stderr → captured by Docker. Inspect with:

```bash
docker compose logs -f backend
docker compose logs -f frontend
```

There is no log shipper, no CloudWatch agent, no log retention policy beyond Docker's defaults. If the host runs out of disk and you can't `ssh` in, the log files at `/var/lib/docker/containers/*/` are usually the culprit.

## Backups

There are none. Set up a daily `aws s3 cp prediction.db s3://...` cron on the EC2 instance, or move the DB out of SQLite, before any pilot or demo where loss matters.

## Security posture (be honest)

| Concern | Status |
|---------|--------|
| HTTPS | None. Everything is plain HTTP. |
| Authentication | Stubbed (`admin/admin`, fake JWT). Effectively open. |
| CORS | Wide open (`CORS(app)`). |
| Rate limiting | None. |
| Input validation | Minimal — uploads accept any CSV/Excel; large files only constrained by nginx's `client_max_body_size 50M` on `/upload/` and `/process/`. |
| Secrets management | The `.pem` is on the developer machine; AWS keys are in `.env` if at all. |
| SSH | Open on port 22 to the world unless you locked the security group. |

Treat the deployed environment as "demo-grade" until you address at least HTTPS + real auth.

## Gotchas, in priority order

1. **`backend/app.py` is dead code.** Editing it does nothing in production. Use `run.py`.
2. **The DB volume in Docker shadows the image's DB.** Updates to the in-repo `prediction.db` will not appear unless you remove the named volume on the host.
3. **Models reload from disk per request** in `/predict_emissions` (via `load_state_models`). Cheap at low traffic, expensive at any real load. If you scale, cache.
4. **Inconsistent key casing across endpoints.** `/predict_emissions` expects `City`/`FuelType`/`VehicleType`; `/predict_consumption` expects `city`/`fuelType`/`vehicleType`. If you add a new endpoint, pick one convention and stick to it.
5. **`/predict_emissions` without `EmissionType`** triggers a buggy code path that appends two response objects per speed. Always pass `EmissionType` explicitly.
6. **The `users` table seeds `admin/admin` on every cold start.** If you change credentials in the DB, a `--volumes` reset will clobber them.
7. **No CI, no tests, no migrations.** Every deploy is a bet that you didn't break something. Bring CI in early if you can.
8. **The `Content-Type` on GET requests** with empty bodies has historically tripped Flask middleware on this codebase. If a GET starts returning 400 with no body, check the client's headers.
9. **`CORS(app)` is global.** If you front this with auth + cookies, you'll need to scope CORS to specific origins or you'll leak credentials.
10. **The pem file**: `traffic-emission-key.pem` mode 0400. If git ever stages it, abort the commit. If it lands in a public mirror, rotate immediately.

## When things are truly broken

If `./deploy.sh` fails and the prod box is also down:

```bash
ssh -i traffic-emission-key.pem ec2-user@$EC2_HOST
cd ~/app
docker compose down
docker compose up -d
docker compose logs --tail 200
```

If Docker itself is unhealthy: `sudo systemctl restart docker`. If the disk is full: `docker system prune -a --volumes` (warning: this drops the DB volume too — back up first).

If the EC2 instance is unreachable over SSH, the AWS console's EC2 Instance Connect or Session Manager is your fallback. The security group must allow inbound 22 from your IP.
