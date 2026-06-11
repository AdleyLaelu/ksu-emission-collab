"""
Train FFNN models on MOVES5 emission data for CA, GA, NY, WA.
Produces .pth checkpoints compatible with run.py's load_model().

Usage:
    python train_moves5.py
"""

import os
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import StandardScaler, OneHotEncoder, PowerTransformer
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error

# ── Config ──────────────────────────────────────────────────────────────────
MOVES5_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "Emission 1", "MOVES 5 Emission data"
)
OUTPUT_DIR = os.path.dirname(__file__)  # backend/

STATES = ["CA", "GA", "NY", "WA"]

EMISSION_TARGETS = {
    "CO2":       {"col": "CO2",              "unit": "g/mile"},
    "Energy":    {"col": "Total Energy",     "unit": "kWh/100km"},
    "NOx":       {"col": "NOx",              "unit": "g/mile"},
    "PM25Brake": {"col": "PM2.5 Brakewear",  "unit": "g/mile"},
    "PM25Tire":  {"col": "PM2.5 Tirewear",   "unit": "g/mile"},
}

# MOVES speed-bin ID → representative speed (mph)
SPEED_BIN_MAP = {
    1: 2.5, 2: 5, 3: 10, 4: 15, 5: 20, 6: 25, 7: 30, 8: 35,
    9: 40, 10: 45, 11: 50, 12: 55, 13: 60, 14: 65, 15: 70, 16: 75,
}

# MOVES sourceTypeID → vehicle-type name (must match existing preprocessor categories)
VEHICLE_MAP = {
    11: "Motorcycle",
    21: "Passenger Car",
    31: "Passenger Truck",
    32: "Light Commercial Truck",
    41: "Other Buses",
    42: "Transit Bus",
    43: "School Bus",
    51: "Refuse Truck",
    52: "Single Unit Short-haul Truck",
    53: "Single Unit Long-haul Truck",
    54: "Motor Home",
    61: "Combination Short-haul Truck",
    62: "Combination Long-haul Truck",
}

# MOVES fuelTypeID → fuel-type name
FUEL_MAP = {
    1: "Gasoline",
    2: "Diesel Fuel",
    3: "Compressed Natural Gas (CNG)",
    5: "Ethanol (E-85)",
    9: "Electricity",
}

# ── Model (must match models.py ModifiedNet) ────────────────────────────────
class ModifiedNet(nn.Module):
    def __init__(self, input_features):
        super().__init__()
        self.fc1 = nn.Linear(input_features, 512)
        self.fc2 = nn.Linear(512, 256)
        self.fc3 = nn.Linear(256, 128)
        self.fc4 = nn.Linear(128, 64)
        self.fc5 = nn.Linear(64, 1)

    def forward(self, x):
        x = torch.relu(self.fc1(x))
        x = torch.relu(self.fc2(x))
        x = torch.relu(self.fc3(x))
        x = torch.relu(self.fc4(x))
        return self.fc5(x)


# ── Helpers ──────────────────────────────────────────────────────────────────
def load_moves5_csv(state: str) -> pd.DataFrame:
    path = os.path.join(MOVES5_DIR, f"Emissions_Output_{state}.csv")
    df = pd.read_csv(path)

    # Map IDs to human-readable names
    df["Vehicle Type"] = df["VehicleID"].map(VEHICLE_MAP)
    df["Fuel Type"] = df["fuelTypeID"].map(FUEL_MAP)

    # Convert speed-bin IDs to actual mph
    df["Speed"] = df["speed"].map(SPEED_BIN_MAP)

    # Rename age
    df["Age"] = df["age"]

    return df


def train_single_model(df: pd.DataFrame, target_col: str, emission_name: str, state: str):
    """Train one FFNN model and return the checkpoint dict."""

    # Drop rows where target is zero or NaN
    df_clean = df[df[target_col] > 0].copy()
    if len(df_clean) < 100:
        print(f"  [SKIP] {state}/{emission_name}: only {len(df_clean)} valid rows")
        return None

    features = ["Vehicle Type", "Fuel Type", "Age", "Speed"]
    X = df_clean[features].copy()
    y = df_clean[[target_col]].values

    # Build preprocessor (same structure as MOVES4 checkpoints)
    preprocessor = ColumnTransformer(
        transformers=[
            ("num", StandardScaler(), ["Age", "Speed"]),
            ("cat", OneHotEncoder(handle_unknown="error", sparse_output=False),
             ["Vehicle Type", "Fuel Type"]),
        ]
    )

    # Target scaler
    target_scaler = PowerTransformer(method="yeo-johnson")

    # Fit preprocessor and target scaler
    X_processed = preprocessor.fit_transform(X)
    y_scaled = target_scaler.fit_transform(y)

    n_features = X_processed.shape[1]

    # Train/test split
    X_train, X_test, y_train, y_test = train_test_split(
        X_processed, y_scaled, test_size=0.2, random_state=42
    )

    # PyTorch tensors
    X_train_t = torch.tensor(X_train, dtype=torch.float32)
    y_train_t = torch.tensor(y_train, dtype=torch.float32)
    X_test_t = torch.tensor(X_test, dtype=torch.float32)
    y_test_t = torch.tensor(y_test, dtype=torch.float32)

    train_ds = TensorDataset(X_train_t, y_train_t)
    train_loader = DataLoader(train_ds, batch_size=64, shuffle=True)

    # Model
    model = ModifiedNet(n_features)
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, patience=10, factor=0.5)
    criterion = nn.MSELoss()

    # Training loop
    best_loss = float("inf")
    best_state = None
    patience_counter = 0
    max_patience = 30

    for epoch in range(300):
        model.train()
        epoch_loss = 0.0
        for xb, yb in train_loader:
            optimizer.zero_grad()
            pred = model(xb)
            loss = criterion(pred, yb)
            loss.backward()
            optimizer.step()
            epoch_loss += loss.item() * xb.size(0)
        epoch_loss /= len(train_ds)

        # Validation
        model.eval()
        with torch.no_grad():
            val_pred = model(X_test_t)
            val_loss = criterion(val_pred, y_test_t).item()

        scheduler.step(val_loss)

        if val_loss < best_loss:
            best_loss = val_loss
            best_state = model.state_dict().copy()
            patience_counter = 0
        else:
            patience_counter += 1
            if patience_counter >= max_patience:
                break

    # Load best weights
    model.load_state_dict(best_state)
    model.eval()

    # Compute metrics
    with torch.no_grad():
        y_pred_scaled = model(X_test_t).numpy()
    y_pred = target_scaler.inverse_transform(y_pred_scaled)
    y_true = target_scaler.inverse_transform(y_test)

    r2 = r2_score(y_true, y_pred)
    rmse = np.sqrt(mean_squared_error(y_true, y_pred))
    mae = mean_absolute_error(y_true, y_pred)

    # MAPE (avoid division by zero)
    mask = np.abs(y_true) > 1e-8
    if mask.sum() > 0:
        mape = np.mean(np.abs((y_true[mask] - y_pred[mask]) / y_true[mask]))
    else:
        mape = 0.0

    metrics = {
        "test_loss": float(best_loss),
        "r2": float(r2),
        "rmse": float(rmse),
        "mape": float(mape),
        "mae": float(mae),
    }

    print(f"  {state}/{emission_name}: features={n_features}, R²={r2:.4f}, RMSE={rmse:.4f}, MAE={mae:.4f}")

    # Build checkpoint (same keys as MOVES4 checkpoints)
    checkpoint = {
        "model_state_dict": best_state,
        "input_features": n_features,
        "preprocessor": preprocessor,
        "power_transformer": target_scaler,
        "target_scaler": target_scaler,
        "y_train_min": float(y.min()),
        "y_train_max": float(y.max()),
        "performance_metrics": metrics,
    }

    return checkpoint


def main():
    for state in STATES:
        print(f"\n{'='*60}")
        print(f"Training models for {state} on MOVES5 data")
        print(f"{'='*60}")

        df = load_moves5_csv(state)
        print(f"  Loaded {len(df)} rows from Emissions_Output_{state}.csv")

        feature_map = {}

        for etype, info in EMISSION_TARGETS.items():
            ckpt = train_single_model(df, info["col"], etype, state)
            if ckpt is None:
                continue

            feature_map[etype] = ckpt["input_features"]

            # Save to models/{STATE}/
            state_dir = os.path.join(OUTPUT_DIR, "models", state)
            os.makedirs(state_dir, exist_ok=True)
            out_path = os.path.join(state_dir, f"best_model_{state}{etype}.pth")
            torch.save(ckpt, out_path)
            print(f"    Saved -> {out_path}")

            # Also save to ml_models/ (flat directory used by run.py globals)
            ml_dir = os.path.join(OUTPUT_DIR, "ml_models")
            if os.path.isdir(ml_dir):
                flat_path = os.path.join(ml_dir, f"best_model_{state}{etype}.pth")
                torch.save(ckpt, flat_path)
                print(f"    Saved -> {flat_path}")

        print(f"\n  Feature map for {state}: {feature_map}")

    print("\nAll MOVES5 models trained and saved.")
    print("  Restart the backend (run.py) to use the new models.")


if __name__ == "__main__":
    main()
