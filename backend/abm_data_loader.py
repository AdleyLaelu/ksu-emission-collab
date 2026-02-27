"""
Activity-Based Model (ABM) Data Loader for Atlanta Traffic Forecasting

This module provides functions to load pre-computed traffic data from the
Atlanta Regional Commission (ARC) Activity-Based Model outputs. The ABM data
provides direct traffic volume and speed outputs, eliminating the need for
MFD equation solving.

Available projection years: 2020, 2030, 2033, 2040, 2050
Coverage: 20 census tracts in downtown Atlanta
"""

import os
import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple

# Base directory for ABM data (relative to this file)
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ABM_DATA_DIR = os.path.join(BASE_DIR, 'atlanta_abm_data')

# Available ABM projection years
AVAILABLE_YEARS = [2020, 2030, 2033, 2040, 2050]

# Atlanta census tract IDs covered by ABM data
ATLANTA_TRACT_IDS = [
    '13121001001', '13121001002', '13121001201', '13121001202', '13121001800',
    '13121001900', '13121002100', '13121002600', '13121002800', '13121003500',
    '13121003600', '13121003800', '13121004300', '13121004400', '13121004800',
    '13121004900', '13121005800', '13121011800', '13121011900', '13121012000'
]


def get_available_years() -> List[int]:
    """
    Get list of available ABM projection years.

    Returns:
        List of available years [2020, 2030, 2033, 2040, 2050]
    """
    return AVAILABLE_YEARS.copy()


def get_atlanta_tract_ids() -> List[str]:
    """
    Get list of Atlanta census tract IDs covered by ABM data.

    Returns:
        List of 20 tract IDs
    """
    return ATLANTA_TRACT_IDS.copy()


def is_abm_available(city_name: str, year: int) -> bool:
    """
    Check if ABM data is available for a given city and year.

    Args:
        city_name: City name (only 'Atlanta' is supported)
        year: Projection year

    Returns:
        True if ABM data is available, False otherwise
    """
    if city_name.lower() != 'atlanta':
        return False
    return year in AVAILABLE_YEARS


def load_atlanta_abm_data(year: int, tract_id: str) -> pd.DataFrame:
    """
    Load ABM traffic data for a single Atlanta census tract.

    Args:
        year: Projection year (2020, 2030, 2033, 2040, or 2050)
        tract_id: Census tract ID (e.g., '13121001800')

    Returns:
        DataFrame with columns: Time, Traffic Volume, Traffic Speed

    Raises:
        ValueError: If year is not available or tract_id is invalid
        FileNotFoundError: If data file does not exist
    """
    if year not in AVAILABLE_YEARS:
        raise ValueError(f"Year {year} not available. Choose from: {AVAILABLE_YEARS}")

    if tract_id not in ATLANTA_TRACT_IDS:
        raise ValueError(f"Tract {tract_id} not in Atlanta ABM coverage. Valid tracts: {ATLANTA_TRACT_IDS}")

    file_path = os.path.join(ABM_DATA_DIR, f'year_{year}', f'tract-{tract_id}.csv')

    if not os.path.exists(file_path):
        raise FileNotFoundError(f"ABM data file not found: {file_path}")

    df = pd.read_csv(file_path)

    # Ensure consistent column names
    expected_columns = ['Time', 'Traffic Volume', 'Traffic Speed']
    if not all(col in df.columns for col in expected_columns):
        raise ValueError(f"ABM data file missing expected columns. Found: {df.columns.tolist()}")

    return df


def load_all_atlanta_tracts(year: int) -> Dict[str, pd.DataFrame]:
    """
    Load ABM traffic data for all Atlanta census tracts for a given year.

    Args:
        year: Projection year (2020, 2030, 2033, 2040, or 2050)

    Returns:
        Dictionary mapping tract_id to DataFrame with traffic data

    Raises:
        ValueError: If year is not available
    """
    if year not in AVAILABLE_YEARS:
        raise ValueError(f"Year {year} not available. Choose from: {AVAILABLE_YEARS}")

    data = {}
    for tract_id in ATLANTA_TRACT_IDS:
        try:
            df = load_atlanta_abm_data(year, tract_id)
            data[tract_id] = df
        except FileNotFoundError as e:
            print(f"Warning: {e}")
            continue

    return data


def process_abm_data_for_emissions(year: int) -> Dict[str, pd.DataFrame]:
    """
    Process ABM data into format compatible with emission model.
    Adds calculated density column: Density = Traffic Volume / Traffic Speed

    Args:
        year: Projection year

    Returns:
        Dictionary mapping tract_id to processed DataFrame with columns:
        Time, Traffic Volume, Traffic Speed, Density, Speed (alias)
    """
    all_data = load_all_atlanta_tracts(year)
    processed = {}

    for tract_id, df in all_data.items():
        processed_df = df.copy()

        # Calculate density from volume and speed
        # Density = Volume / Speed (handling division by zero)
        processed_df['Density'] = np.where(
            processed_df['Traffic Speed'] > 0,
            processed_df['Traffic Volume'] / processed_df['Traffic Speed'],
            np.nan
        )

        # Add Speed alias column for compatibility with MFD output format
        processed_df['Speed'] = processed_df['Traffic Speed']

        # Add Adjusted Traffic Volume for compatibility
        processed_df['Adjusted Traffic Volume'] = processed_df['Traffic Volume']

        processed[tract_id] = processed_df

    return processed


def save_abm_to_excel(year: int, output_path: Optional[str] = None) -> str:
    """
    Save ABM data to Excel file in same format as MFD output.

    Args:
        year: Projection year
        output_path: Optional output file path. If not provided, uses default location.

    Returns:
        Path to saved Excel file
    """
    if output_path is None:
        output_dir = os.path.join(BASE_DIR, 'Combined_sheet_output_speed', 'GA')
        os.makedirs(output_dir, exist_ok=True)
        output_path = os.path.join(output_dir, f'GA_{year}_ABM.xlsx')

    processed_data = process_abm_data_for_emissions(year)

    with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
        for tract_id, df in processed_data.items():
            sheet_name = f'tract={tract_id}'
            df.to_excel(writer, sheet_name=sheet_name, index=False)

    return output_path


def get_abm_summary(year: int) -> Dict:
    """
    Get summary statistics for ABM data for a given year.

    Args:
        year: Projection year

    Returns:
        Dictionary with summary statistics
    """
    all_data = load_all_atlanta_tracts(year)

    summary = {
        'year': year,
        'tracts_loaded': len(all_data),
        'total_tracts': len(ATLANTA_TRACT_IDS),
        'tract_stats': {}
    }

    for tract_id, df in all_data.items():
        summary['tract_stats'][tract_id] = {
            'records': len(df),
            'avg_volume': df['Traffic Volume'].mean(),
            'avg_speed': df['Traffic Speed'].mean(),
            'max_volume': df['Traffic Volume'].max(),
            'min_speed': df['Traffic Speed'].min()
        }

    return summary


def interpolate_year(target_year: int) -> Tuple[int, int, float]:
    """
    Get interpolation parameters for years not directly available.

    Args:
        target_year: Year to interpolate

    Returns:
        Tuple of (lower_year, upper_year, weight) where weight is for lower_year
        Returns None if target_year is exactly available
    """
    if target_year in AVAILABLE_YEARS:
        return (target_year, target_year, 1.0)

    if target_year < min(AVAILABLE_YEARS) or target_year > max(AVAILABLE_YEARS):
        raise ValueError(f"Target year {target_year} outside ABM range {min(AVAILABLE_YEARS)}-{max(AVAILABLE_YEARS)}")

    # Find surrounding years
    lower_year = max(y for y in AVAILABLE_YEARS if y < target_year)
    upper_year = min(y for y in AVAILABLE_YEARS if y > target_year)

    # Linear interpolation weight
    weight = (upper_year - target_year) / (upper_year - lower_year)

    return (lower_year, upper_year, weight)


def load_interpolated_data(target_year: int, tract_id: str) -> pd.DataFrame:
    """
    Load ABM data for a year, interpolating if necessary.

    Args:
        target_year: Target year
        tract_id: Census tract ID

    Returns:
        DataFrame with interpolated traffic data
    """
    lower_year, upper_year, weight = interpolate_year(target_year)

    if lower_year == upper_year:
        return load_atlanta_abm_data(lower_year, tract_id)

    df_lower = load_atlanta_abm_data(lower_year, tract_id)
    df_upper = load_atlanta_abm_data(upper_year, tract_id)

    # Interpolate numeric columns
    result = df_lower.copy()
    result['Traffic Volume'] = (
        weight * df_lower['Traffic Volume'] +
        (1 - weight) * df_upper['Traffic Volume']
    )
    result['Traffic Speed'] = (
        weight * df_lower['Traffic Speed'] +
        (1 - weight) * df_upper['Traffic Speed']
    )

    return result
