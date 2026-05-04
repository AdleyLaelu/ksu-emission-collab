# 04 — API Reference

Every Flask route exposed by `backend/run.py`, in the order you'll likely hit them.

Conventions:

- All routes live on the backend container at `http://backend:5003` internally, or `http://<host>/<path>` externally (nginx proxies a fixed list — see [03-codebase-tour.md](03-codebase-tour.md) for the proxied paths).
- All POST bodies are JSON unless explicitly multipart.
- The "global transaction id" is the literal string `"emission-analysis-2025"`. There is no per-user/per-session id.

## Health

### `GET /health`

Liveness probe. Used by Docker healthcheck and the EC2 deploy script.

**Response (200):**
```json
{ "status": "healthy" }
```

## Auth (placeholder)

### `POST /auth/login`

Looks up `(username, password)` in the `users` table. Seeded with `admin / admin`. Returns a fixed string `"fake-jwt"` — there is no real JWT, no signature, nothing checks the token. Treat this as not-yet-implemented.

**Request:**
```json
{ "username": "admin", "password": "admin" }
```

**Response (200):**
```json
{ "status": "ok", "token": "fake-jwt" }
```

**Response (401):**
```json
{ "status": "fail" }
```

## Admin

### `POST /admin/clear_db`

Wipes every table except `users`. No auth.

**Response (200):**
```json
{
  "status": "success",
  "message": "Database cleared successfully",
  "cleared_tables": [{ "table": "vehicle_classification", "rows_deleted": 42 }, ...]
}
```

### `GET /admin/transaction_id`

Returns the current global transaction id. Provided so the UI can display it; not actually used for anything stateful.

**Response (200):**
```json
{
  "transaction_id": "emission-analysis-2025",
  "latest_transaction_id": "emission-analysis-2025",
  "message": "This is the consistent transaction ID used for all operations"
}
```

## Uploads

All upload routes are multipart unless noted. They write to `*_data` tables (the `_data`-suffixed variants are the live ones — see [01-architecture.md](01-architecture.md)).

### `POST /upload/<type>`

Generic uploader. Valid `type` values: `vehicle_classification`, `penetration_rate`, `traffic_volume`, `projected_traffic`, `mfd_params`.

Behavior branches by type:

- **`vehicle_classification`** — single `file` (CSV or .xlsx). Form fields: `city_name`/`city`, `vehicle_type`, `year`/`base_year`, `user_id`. Renames columns (`City`→`data_city`, `Vehicle Type`→`data_vehicle_type`, `Vehicle Count`→`vehicle_count`, `penetration`→`age`), adds metadata, writes to `vehicle_classification_data`.
- **`penetration_rate`** — single `file`. Same metadata pattern. Writes to `penetration_rate_data`.
- **`traffic_volume`** — **two files**: `file1` (traffic volume CSV/Excel with columns `VehicleType, base year, Distance, Time`) and `file2` (MFD parameters CSV/Excel). Computes `Speed = Distance / Time` if both present. `file2` is melted into key/value rows for `mfd_params`. Form fields: `city_name`, `vehicle_type`, `transaction_id` (optional, defaults to global).
- **`projected_traffic`** — single `file`. Renames `Tract`/`Year`/`Volume` → lowercase. Writes to `projected_traffic` (note: this is the legacy table, not `_data`).
- **`mfd_params`** — **JSON body** (not multipart!) with `{ city, base_year, mfd_table_data, mfd_table_headers }`. Useful for inline-edited tables.

**Response (200):**
```json
{ "status": "ok", "rows": 123, "transaction_id": "emission-analysis-2025" }
```

For `traffic_volume`, the response includes a nested `rows` object and a `debug` block listing column names. The debug block is intentional — strip if you sanitize for production.

### `POST /upload/projected_traffic`

Specialized uploader for projected traffic. Multipart form with:

- `city_name` (string, required)
- `year` (string, required)
- `file_csv` (master CSV with columns `Tract ID, Traffic Volume`, required)
- `file_table` — either a file (CSV or JSON) **or** a form-string of JSON, with detail rows (`time, datetime, Traffic Volume, Traffic Speed, Adjusted Traffic, Density, Speed`)
- `transaction_id` (optional, defaults to global)

Writes to `projected_traffic_volume` (master) and `projected_traffic_details` (detail). Both tables get the same `transaction_id`.

**Response (200):**
```json
{
  "status": "ok",
  "transaction_id": "emission-analysis-2025",
  "volume_rows": 20,
  "detail_rows": 96
}
```

## Predictions

### `POST /predict/<kind>`

Legacy single-prediction route. `kind` is one of `co2`, `energy`, `nox`, `brake`, `tire`. Uses the legacy global `MLPRegressor` models (not the `ModifiedNet` per-state set). Mostly superseded by `/predict_emissions`.

**Request:**
```json
{
  "State": "GA",
  "Age": 5,
  "Speed": 60,
  "Vehicle Type": "Passenger Car",
  "Fuel Type": "Gasoline"
}
```

For `kind=brake`, also include `"Vehicle Weight": 1500`. For `kind=tire`, also include `"Road Gradient": 5`.

**Response (200):**
```json
{ "prediction_type": "co2", "value": 0.234567, "unit": "g/km" }
```

### `POST /scenarios/vehicles`

Batch CO2 + NOx predictions across multiple ages.

**Request:**
```json
{
  "years": [2020, 2025, 2030],
  "state": "GA",
  "payload": { "Vehicle Type": "Passenger Car", "Fuel Type": "Gasoline" }
}
```

**Response (200):**
```json
{
  "2020": { "CO2": 0.2345, "NOx": 0.0012 },
  "2025": { "CO2": 0.2100, "NOx": 0.0010 },
  "2030": { "CO2": 0.1800, "NOx": 0.0008 }
}
```

### `POST /predict_emissions`

**The main prediction route.** Returns per-speed (0..70) emission predictions using the production `ModifiedNet` checkpoints. Models are reloaded from disk on every call via `load_state_models(city_name)`.

**Request:**
```json
{
  "City": "Atlanta",
  "FuelType": "Gasoline",
  "VehicleType": "Passenger Car",
  "Age": 5,
  "EmissionType": "CO2 Emissions"
}
```

`EmissionType` accepts: `"CO2 Emissions"`, `"Energy Rate"`, `"NOx"`, `"PM2.5 Brake Wear"`, `"PM2.5 Tire Wear"`. Omit it to get all five for every speed (the response shape changes when you do — see below).

For PM2.5 Brake Wear, optionally include `"VehicleWeight": 1500` (default 1500). For PM2.5 Tire Wear, optionally include `"RoadGradient": 5` (default 5).

**Response (200), single emission type:** array of 71 objects:
```json
[
  {
    "EmissionType": "CO2 Emissions",
    "PredictedValue": 0.234567,
    "Unit": "g/mile",
    "Speed": 0,
    "VehicleType": "Passenger Car",
    "FuelType": "Gasoline",
    "City": "Atlanta",
    "State": "GA"
  },
  ...
]
```

**Response (200), all emission types:** mixed shape per speed (one object with all five labels, plus a stray duplicate object — there is a bug in the loop where it appends both `multi_result` and a `result` dict; see `run.py` ~L946). Don't rely on the all-types branch.

### `POST /predict_consumption`

Per-speed (0..69) fuel consumption. Uses the same per-state energy rate model, then divides by per-fuel kJ-per-unit constants.

**Request:**
```json
{
  "city": "Atlanta",
  "fuelType": "Gasoline",
  "vehicleType": "Passenger Car",
  "vehicleAge": 5
}
```

Note the **lowercase keys** here vs. the uppercase keys in `/predict_emissions`. This inconsistency is a real footgun.

**Response (200):** array of 70 objects:
```json
[
  {
    "city": "Atlanta",
    "state": "GA",
    "vehicle_type": "Passenger Car",
    "fuel_type": "Gasoline",
    "age": 5.0,
    "speed": 0,
    "energy_kj_per_mile": 1234.567,
    "fuel_consumption": 0.012345,
    "fuel_unit": "gallon/mile"
  },
  ...
]
```

`fuel_unit` is `"gallon/mile"` for Gasoline/Diesel/E-85, `"GGE/mile"` for CNG, `"kWh/mile"` for Electricity.

## Traffic processing

### `POST /process/traffic`

Run the MFD-based traffic analysis. Multipart form with:

- `parameters_file` — MFD parameters CSV (`Tract ID, λ, v_f, Q_m, k_j, w`)
- `traffic_volume_file` — Traffic volume CSV (`Tract ID, Time, Traffic Volume`)
- `city_name` — string
- `year` — string

Solves the MFD equations and writes a per-tract Excel file to `backend/Combined_sheet_output_speed/<STATE>/<STATE>_<YEAR>.xlsx`.

**Response (200):** an object whose shape is determined by `traffic_processor.run_traffic_analysis`. Includes `status: "success"` on success.

### `POST /process/traffic/abm`

Atlanta-only. Uses the pre-computed ARC ABM data, eliminating the MFD solve.

**Request (JSON body, not multipart):**
```json
{ "city_name": "Atlanta", "year": 2030, "method": "auto" }
```

`method` is one of `"auto"` (default), `"abm"`, or `"mfd"` (which redirects with a 400).

For exact ABM years (2020/2030/2033/2040/2050), uses the data directly. For other years in [2020, 2050], linear interpolation. Outputs to `Combined_sheet_output_speed/GA/GA_<YEAR>_ABM{,_interpolated}.xlsx`.

**Response (200):**
```json
{
  "status": "success",
  "message": "ABM traffic processing complete for Atlanta (2030)",
  "method_used": "abm_direct",
  "tracts_processed": 20,
  "output_file": "/app/Combined_sheet_output_speed/GA/GA_2030_ABM.xlsx",
  "available_abm_years": [2020, 2030, 2033, 2040, 2050]
}
```

### `POST /process/traffic/abm/upload`

Process a user-uploaded ABM CSV (any city). Multipart form:

- `file` — CSV with columns `Tract ID, Time, Traffic Volume, Traffic Speed`
- `city_name` — must be in `CITY_TO_STATE` (Atlanta/LosAngeles/NewYork/Seattle)
- `year` — string

Splits by tract, computes `Density = Volume / Speed`, writes to `Combined_sheet_output_speed/<STATE>/<STATE>_<YEAR>_ABM.xlsx`.

**Response (200):**
```json
{
  "status": "success",
  "message": "ABM data processed for Atlanta (2024)",
  "method_used": "abm_upload",
  "tracts_processed": 20,
  "tract_ids": ["13121001001", ...]
}
```

### `GET /abm/info`

Metadata about the available ABM data.

Optional query string: `?year=2030` to include a per-year summary.

**Response (200):**
```json
{
  "available_years": [2020, 2030, 2033, 2040, 2050],
  "supported_cities": ["Atlanta"],
  "tract_count": 20,
  "tract_ids": ["13121001001", ...],
  "data_source": "Atlanta Regional Commission (ARC) Activity-Based Model - MTP24"
}
```

## Plotting

### `GET /plot/traffic/data/<city_name>/<year>`

Returns raw JSON traffic data for client-side Chart.js rendering. **This is the route the frontend actually uses.**

Optional `?source=mfd` or `?source=abm` to force a data source. Default priority: ABM Direct > ABM Interpolated > MFD.

**Response (200):**
```json
{
  "dataSource": "ABM Direct",
  "city": "Atlanta",
  "state": "GA",
  "year": "2030",
  "tracts": [
    {
      "tractId": "13121001001",
      "time": [0.0, 0.25, 0.5, ...],
      "speed": [42.1, 41.8, ...],
      "volume": [120.5, 115.2, ...]
    },
    ...
  ]
}
```

`time` is hours-of-day (4 samples per hour). `speed` and `volume` are interpolated through NaN gaps using `scipy.interpolate.interp1d`.

### `GET /plot/traffic/<city_name>/<year>`

Server-side matplotlib plot, returned as `image/png`. Mostly unused; the frontend prefers the JSON endpoint above.

## Results

### `GET /results/emissions?city=<city>&year=<year>`

Pulls vehicle classifications from the DB for a city, runs CO2 prediction on each. Hardcoded to GA models. Mostly demo-grade — you probably want `/predict_emissions` instead.

### `GET /results/download`

Returns `SELECT * FROM results` as a CSV file download (`results.csv`). The `results` table is rarely populated, so this is usually empty.

## Routes that don't exist (but the frontend references)

- `/predict/by-model` — referenced from `frontend/src/api/prediction.ts`. There is no such route on the backend. The wrapper appears unused; if you wire it up, decide first whether you actually need it.

## Postman

Import any of these for one-click testing:

- [backend/postman_collection.json](../backend/postman_collection.json)
- [backend/postman_collection_full_ga.json](../backend/postman_collection_full_ga.json)
- [backend/postman_collection_ga.json](../backend/postman_collection_ga.json)
- [backend/Emission_Routes.postman_collection.json](../backend/Emission_Routes.postman_collection.json)
