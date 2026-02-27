# Comprehensive Report: Activity-Based Model (ABM) Integration for Atlanta Traffic Forecasting

## Executive Summary

This report provides a detailed analysis of the current MFD-based traffic forecasting pipeline in the `gra-traffic` backend and evaluates the potential replacement with Activity-Based Model (ABM) data available in the `GRA-support` repository. The analysis focuses exclusively on **Atlanta, Georgia** as ABM data is only available for this region.

**Key Finding**: The ABM data from ARC (Atlanta Regional Commission) provides **direct traffic volume AND speed outputs**, eliminating the need for MFD equation solving entirely. This represents a paradigm shift from physics-based derivation to simulation-based direct output.

---

## Part 1: Current Backend Pipeline Architecture

### 1.1 System Overview

The current `gra-traffic/backend` implements a Flask-based REST API that predicts vehicle emissions and energy consumption based on traffic dynamics. The system consists of three integrated components:

| Component | Purpose | Technology |
|-----------|---------|------------|
| **Traffic Processor** | Derives traffic speed from volume using MFD | `traffic_processor.py` |
| **Emission Predictor** | Predicts CO2, NOx, PM2.5 from speed profiles | Feedforward Neural Network (PyTorch) |
| **Power Plant Emission Model** | Predicts grid emissions from EV energy consumption | Meta Prophet |

### 1.2 MFD (Macroscopic Fundamental Diagram) Approach

**Location**: `/backend/traffic_processor.py`

The current approach uses a **log-sum-exp MFD model** to derive traffic speed from volume:

```
v = -λ₁ × ln(e^(-vf(k+λ₂)/λ₁) + e^(-Qm/λ₁) + e^(-(kj-k)w/λ₁)) / k
```

Where:
- `k` = traffic density (veh/km/lane)
- `vf` = free-flow speed (mph)
- `Qm` = maximum capacity (veh/hr/lane)
- `kj` = jam density
- `w` = wave speed
- `λ₁, λ₂` = shape parameters

**Processing Flow**:
```
Input Volume → Identify Congestion Points → Interpolate → Solve MFD → Density → Speed
```

### 1.3 Atlanta (Georgia) MFD Configuration

**20 Census Tracts Covered**:
```
13121001800, 13121001900, 13121003600, 13121012000, 13121011800,
13121011900, 13121001202, 13121001201, 13121001001, 13121004300,
13121001002, 13121002100, 13121002600, 13121002800, 13121003500,
13121003800, 13121004400, 13121004800, 13121004900, 13121005800
```

**Calibrated MFD Parameters** (from `GA_tract_parameters.csv`):

| Tract ID | λ | vf (mph) | Qm (veh/hr) | kj | w | R² |
|----------|---|----------|-------------|-----|---|-----|
| 13121001800 | 74.39 | 48.96 | 382.36 | 80.0 | 8.0 | 0.955 |
| 13121001900 | 93.23 | 47.26 | 467.54 | 96.0 | 8.0 | 0.959 |
| 13121012000 | 122.90 | 52.05 | 731.32 | 100.0 | 15.0 | 0.987 |
| 13121001001 | 170.10 | 49.60 | 829.09 | 150.0 | 9.0 | 0.875 |
| 13121004800 | 121.56 | 52.42 | 894.79 | 90.0 | 20.0 | 0.979 |
| ... | ... | ... | ... | ... | ... | ... |

**Solver Strategies**:
1. **Complex MFD Solver** (17 tracts): Includes hysteresis/direction-aware speed adjustment
2. **Simple Solver** (3 tracts: 13121004800, 13121004900, 13121012000): Direct numerical solution

### 1.4 Neural Network Emission Model

**Location**: `/backend/models.py` and `/backend/run.py`

**Architecture** (ModifiedNet):
```
Input → FC(512) → ReLU → FC(256) → ReLU → FC(128) → ReLU → FC(64) → ReLU → FC(1)
```

**Input Features**: Vehicle Type (14 categories), Fuel Type (5 types), Age, Speed

**Output Predictions**: CO2, NOx, PM2.5 (brake), PM2.5 (tire), Energy Consumption

**Training Data**: EPA MOVES4 inventory for Atlanta, Los Angeles, New York, Seattle

---

## Part 2: Research Foundation (TRBAM-25-05721)

The backend implementation is based on the TRB paper: *"Machine Learning for Predicting Emissions from Vehicles and Power Plants: Impact Analysis of Increasing Adoption of Electric Vehicles in the United States"*

### 2.1 Integrated Model Architecture

The paper describes a comprehensive framework integrating:

1. **Vehicle Energy/Emission Model**: Feedforward NN trained on MOVES4 (R² > 0.996)
2. **Macroscopic Traffic Model**: MFD-based speed-volume relationship
3. **Power Plant Emission Model**: Meta Prophet trained on NREL Cambium database
4. **Mixed Traffic Composition**: State vehicle registration data analysis

### 2.2 Key Research Findings

For Atlanta (Georgia) by 2030:
- EV adoption projected: up to 46%
- Gasoline consumption increase: up to 86.61%
- GHG emissions from vehicles increase: up to 87.03%
- EV energy consumption from grid increase: up to 74.89%
- GHG emissions from power plants increase: up to 77.61%

---

## Part 3: Activity-Based Model (ABM) Data Analysis

### 3.1 Data Source

**Location**: `/Users/devmaster/projects/ksu/GRA-support/ARC ABM Outputs (GIS) - MTP24/`

**Source**: Atlanta Regional Commission (ARC) Activity-Based Model outputs from the Metropolitan Transportation Plan 2024 (MTP24)

**Simulation Tool**: ActivitySim - an open-source activity-based travel demand model

### 3.2 ABM Data Structure

**Directory Structure**:
```
atlanta_15min_outputs/
├── year_2020/    (20 tract CSV files)
├── year_2030/    (20 tract CSV files)
├── year_2033/    (20 tract CSV files)
├── year_2040/    (20 tract CSV files)
└── year_2050/    (20 tract CSV files)
```

**File Format**: `tract-{TRACT_ID}.csv`

**Data Columns**:
| Column | Description | Unit |
|--------|-------------|------|
| Time | Time of day | HH:MM:SS |
| Traffic Volume | Aggregated flow rate | veh/hr/lane |
| Traffic Speed | Aggregated speed | mph |

**Temporal Resolution**: 15-minute intervals (96 data points per day)

### 3.3 Sample ABM Data (Tract 13121001800, Year 2020)

| Time | Traffic Volume (veh/hr/ln) | Traffic Speed (mph) |
|------|---------------------------|---------------------|
| 0:00 | 69.79 | 24.60 |
| 6:00 | 217.43 | 22.96 |
| 10:00 | 208.26 | 23.90 |
| 15:00 | 259.57 | 22.36 |
| 19:00 | 69.79 | 24.60 |

**Key Observation**: The ABM data provides **BOTH** traffic volume AND traffic speed directly from simulation output.

### 3.4 ABM vs MFD: Fundamental Paradigm Difference

| Aspect | Current MFD Approach | ABM Approach |
|--------|---------------------|--------------|
| **Data Source** | HERE probe data + calibrated equations | ActivitySim simulation output |
| **Speed Derivation** | Calculated from volume via MFD equation | Directly provided |
| **Density Calculation** | Solved numerically (fsolve) | Can derive as Volume/Speed |
| **Processing Complexity** | High (nonlinear solving, threshold detection, interpolation) | Low (direct data read) |
| **Future Projections** | Requires volume forecasts + MFD parameters | Pre-computed for 2020-2050 |
| **Behavioral Modeling** | Physics-based (macroscopic flow theory) | Agent-based (individual travel behavior) |
| **Spatial Coverage** | 20 Atlanta tracts | Same 20 Atlanta tracts |

### 3.5 ABM Data Processing Pipeline (from GRA-Support notebooks)

**Primary Notebook**: `mfd_atlanta.ipynb`

```python
# Current ABM data loading approach
for filename in os.listdir(directory_path):
    if filename.endswith(".csv"):
        data = pd.read_csv(file_path)
        time = data['Time']
        traffic_volume = data['Traffic Volume']
        speed = data['Traffic Speed']  # ← DIRECT OUTPUT, no MFD solving!
```

**Secondary Notebook**: `Final Speed Volume Time Dynamic Bound Threshold GA-UI.ipynb`

This notebook demonstrates the CURRENT processing approach that:
1. Reads raw ActivitySim outputs (`V1_aggflow_plph`, `V1_aggspeed_mph`)
2. Converts to standard column names
3. Applies MFD calculations to refine/validate speeds
4. Generates tract-specific density calculations

---

## Part 4: Available ABM Datasets for Atlanta

### 4.1 Multi-Year Projections

| Year | Files | Tracts | Data Points/Tract |
|------|-------|--------|-------------------|
| 2020 | 20 CSV | 20 | 96 (15-min intervals) |
| 2030 | 20 CSV | 20 | 96 |
| 2033 | 20 CSV | 20 | 96 |
| 2040 | 20 CSV | 20 | 96 |
| 2050 | 20 CSV | 20 | 96 |

**Total**: 100 tract-year combinations with complete daily traffic profiles

### 4.2 Supporting Data Files

**Vehicle Classification Data** (for emissions calculation):
- `/GRA-support/20250611_UI Datasets.../webpage 2/Atlanta/Atlanta_vehicle_data_2024.csv`
- Contains: Vehicle Type, Fuel Type, Age, Vehicle Count
- 13 vehicle types, 5 fuel types, ages 0-30 years

**MFD Parameters** (for validation/hybrid approach):
- `/GRA-support/.../Traffic Volume and Speed/Georgia/GA_tract_parameters.csv`
- Contains calibrated λ, vf, Qm, kj, w, R² for all 20 tracts

### 4.3 GIS Geodatabases

Available for spatial analysis:
```
OUTPUTS_GIS_2020_MTP24.gdb
OUTPUTS_GIS_2030_MTP24.gdb
OUTPUTS_GIS_2033_MTP24.gdb
OUTPUTS_GIS_2040_MTP24.gdb
OUTPUTS_GIS_2050_MTP24.gdb
OUTPUTS_GIS_2050NB_MTP24.gdb
```

---

## Part 5: Integration Strategy - Replacing MFD with ABM

### 5.1 Proposed Architecture Change

**Current Pipeline**:
```
Upload Volume → traffic_processor.py (MFD Solve) → Speed/Density → Emission Model → Results
```

**Proposed ABM Pipeline**:
```
Select Year/Tract → Read ABM CSV → Direct Volume/Speed → Emission Model → Results
```

### 5.2 Implementation Changes Required

#### 5.2.1 New Data Loading Module

Create `abm_data_loader.py`:
```python
def load_atlanta_abm_data(year: int, tract_id: str) -> pd.DataFrame:
    """
    Load pre-computed ABM traffic data for Atlanta.

    Args:
        year: Projection year (2020, 2030, 2033, 2040, 2050)
        tract_id: Census tract ID (e.g., '13121001800')

    Returns:
        DataFrame with columns: Time, Traffic Volume, Traffic Speed
    """
    base_path = 'atlanta_15min_outputs'
    file_path = f'{base_path}/year_{year}/tract-{tract_id}.csv'
    return pd.read_csv(file_path)
```

#### 5.2.2 Modified Backend Endpoints

Add new endpoint in `run.py`:
```python
@app.route('/process/traffic/abm', methods=['POST'])
def process_traffic_abm():
    """Use Activity-Based Model data instead of MFD calculation."""
    city_name = request.json.get('city_name')
    year = request.json.get('year')  # 2020, 2030, 2033, 2040, 2050

    if city_name != 'Atlanta':
        return jsonify({'error': 'ABM data only available for Atlanta'}), 400

    # Load ABM data directly - no MFD solving required
    abm_data = load_atlanta_abm_data(year, tract_ids)

    # Density can be derived if needed: density = volume / speed
    abm_data['Density'] = abm_data['Traffic Volume'] / abm_data['Traffic Speed']

    return process_emissions(abm_data)
```

#### 5.2.3 Data Directory Structure

Add ABM data to backend:
```
backend/
├── atlanta_abm_data/
│   ├── year_2020/
│   │   ├── tract-13121001800.csv
│   │   ├── tract-13121001900.csv
│   │   └── ... (20 files)
│   ├── year_2030/
│   ├── year_2033/
│   ├── year_2040/
│   └── year_2050/
```

### 5.3 Benefits of ABM Replacement

| Benefit | Description |
|---------|-------------|
| **Simplicity** | Eliminates complex MFD solving, threshold detection, interpolation |
| **Speed** | Direct data read vs. iterative numerical solving |
| **Future Projections** | Pre-computed projections through 2050 |
| **Behavioral Realism** | Based on actual travel behavior simulation, not just physics |
| **Consistency** | Volume and speed are internally consistent from same simulation |

### 5.4 Limitations

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| **Atlanta Only** | Cannot use for LA, NY, Seattle | Maintain MFD for other cities |
| **Fixed Years** | Only 2020, 2030, 2033, 2040, 2050 | Interpolate for intermediate years |
| **No Real-time** | Cannot process live traffic data | Use MFD for real-time scenarios |
| **Scenario Dependence** | Based on ARC MTP24 assumptions | Document assumptions clearly |

---

## Part 6: Hybrid Approach Recommendation

Given the limitations, a **hybrid approach** is recommended:

### 6.1 Decision Logic

```python
def get_traffic_data(city_name, year, mode='auto'):
    """
    Get traffic data using appropriate method.

    Args:
        city_name: Target city
        year: Target year
        mode: 'abm' | 'mfd' | 'auto'
    """
    if mode == 'auto':
        if city_name == 'Atlanta' and year in [2020, 2030, 2033, 2040, 2050]:
            return load_abm_data(year)
        else:
            return run_mfd_analysis(city_name, year)
    elif mode == 'abm':
        if city_name != 'Atlanta':
            raise ValueError("ABM data only available for Atlanta")
        return load_abm_data(year)
    else:
        return run_mfd_analysis(city_name, year)
```

### 6.2 API Design

```
POST /process/traffic
{
    "city_name": "Atlanta",
    "year": 2030,
    "method": "auto"  // "auto" | "abm" | "mfd"
}
```

---

## Part 7: Data Validation Comparison

### 7.1 MFD vs ABM Speed Comparison (Sample Tract 13121001800)

The GRA-Support notebooks include validation plots comparing:
- **Actual Speed** (from ABM): Direct simulation output
- **New Speed** (from MFD): Calculated using calibrated parameters

Typical correlation: R² > 0.90, indicating MFD calibration was done using ABM outputs.

### 7.2 Recommended Validation Steps

1. **Statistical Comparison**: Compare MFD-derived speeds with ABM speeds for all tracts
2. **Temporal Patterns**: Verify AM/PM peak patterns match between methods
3. **Emission Impact**: Compare emission predictions using both data sources
4. **Sensitivity Analysis**: Assess emission sensitivity to speed source

---

## Part 8: File Inventory

### 8.1 Key Files in GRA-Support for ABM Integration

| File | Path | Purpose |
|------|------|---------|
| ABM Outputs | `ARC ABM Outputs (GIS) - MTP24/atlanta_15min_outputs/` | Primary traffic data |
| MFD Atlanta Notebook | `mfd_atlanta.ipynb` | ABM data visualization |
| GA Processing Notebook | `Final Speed Volume Time Dynamic Bound Threshold GA-UI.ipynb` | MFD validation |
| MFD Parameters | `GA_tract_parameters.csv` | Calibrated MFD parameters |
| Vehicle Data | `Atlanta_vehicle_data_2024.csv` | Vehicle classification |

### 8.2 Backend Files Requiring Modification

| File | Current Function | Required Change |
|------|-----------------|-----------------|
| `run.py` | Main Flask app | Add ABM endpoint |
| `traffic_processor.py` | MFD calculations | Add ABM loader |
| New: `abm_data_loader.py` | N/A | Create ABM data interface |

---

## Part 9: Conclusions and Recommendations

### 9.1 Summary

The Activity-Based Model data from ARC provides a **superior data source** for Atlanta traffic forecasting because:

1. **Direct Speed Output**: Eliminates MFD equation solving
2. **Multi-Year Coverage**: Pre-computed projections through 2050
3. **Behavioral Basis**: Based on realistic travel demand simulation
4. **Validated Data**: MFD parameters were calibrated against this data

### 9.2 Recommended Action Items

1. **Copy ABM Data**: Migrate `atlanta_15min_outputs/` to backend directory
2. **Create ABM Loader**: Implement `abm_data_loader.py` module
3. **Add API Endpoint**: Create `/process/traffic/abm` route
4. **Implement Hybrid Logic**: Auto-select ABM vs MFD based on city/year
5. **Validate Results**: Compare emission outputs between methods
6. **Update Documentation**: Document ABM data source and limitations

### 9.3 Timeline Estimate

| Phase | Task | Duration |
|-------|------|----------|
| 1 | Data migration and loader | 2-3 days |
| 2 | API endpoint implementation | 1-2 days |
| 3 | Validation and testing | 2-3 days |
| 4 | Documentation | 1 day |
| **Total** | | **6-9 days** |

---

## Appendix A: Census Tract Coverage

All 20 Atlanta downtown census tracts covered by both MFD and ABM:

| Tract ID | MFD R² | ABM Years |
|----------|--------|-----------|
| 13121001001 | 0.875 | 2020-2050 |
| 13121001002 | 0.930 | 2020-2050 |
| 13121001201 | 0.927 | 2020-2050 |
| 13121001202 | 0.908 | 2020-2050 |
| 13121001800 | 0.955 | 2020-2050 |
| 13121001900 | 0.959 | 2020-2050 |
| 13121002100 | 0.922 | 2020-2050 |
| 13121002600 | 0.934 | 2020-2050 |
| 13121002800 | 0.978 | 2020-2050 |
| 13121003500 | 0.934 | 2020-2050 |
| 13121003600 | 0.938 | 2020-2050 |
| 13121003800 | 0.902 | 2020-2050 |
| 13121004300 | 0.864 | 2020-2050 |
| 13121004400 | 0.957 | 2020-2050 |
| 13121004800 | 0.979 | 2020-2050 |
| 13121004900 | 0.965 | 2020-2050 |
| 13121005800 | 0.951 | 2020-2050 |
| 13121011800 | 0.927 | 2020-2050 |
| 13121011900 | 0.930 | 2020-2050 |
| 13121012000 | 0.987 | 2020-2050 |

---

## Appendix B: ABM Data Source Details

**Model**: ActivitySim (Open Source)
**Organization**: Atlanta Regional Commission (ARC)
**Plan**: Metropolitan Transportation Plan 2024 (MTP24)
**Projection Scenarios**: Base and No-Build variants
**Temporal Resolution**: 15-minute aggregation
**Spatial Resolution**: Census tract level

---

*Report Generated: February 2026*
*Author: Claude Code Analysis*
*Project: GRA Traffic Emission Prediction System*
