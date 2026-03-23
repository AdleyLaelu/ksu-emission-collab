import useAppStore from "../useAppStore";
import { useState } from "react";
import GridChartR3, { SCENARIO_COLORS } from "./GridChartR3";
import VehicleChartR1R2, { TRACT_COLORS } from "./VehicleChartR1R2";

const FUEL_TYPES = ["CNG", "Diesel", "Electricity", "Ethanol", "Gasoline"];

import GA_R1 from "../assets/r1r2data/GA_R1.json";
import GA_R2 from "../assets/r1r2data/GA_R2.json";
import CA_R1 from "../assets/r1r2data/CA_R1.json";
import CA_R2 from "../assets/r1r2data/CA_R2.json";
import NY_R1 from "../assets/r1r2data/NY_R1.json";
import NY_R2 from "../assets/r1r2data/NY_R2.json";
import WA_R1 from "../assets/r1r2data/WA_R1.json";
import WA_R2 from "../assets/r1r2data/WA_R2.json";
import GA_CO2 from "../assets/r3data/GA_CO2.json";

const DATA_MAP = { GA_R1, GA_R2, CA_R1, CA_R2, NY_R1, NY_R2, WA_R1, WA_R2 };
const CITY_TO_STATE = {
  Atlanta: "GA", "Los Angeles": "CA", LosAngeles: "CA", NewYork: "NY", Seattle: "WA",
};

const CITY_OPTIONS = ["Atlanta", "Los Angeles", "New York", "Seattle"];

const VEHICLE_TYPES = [
  "Combination Long-haul Truck",
  "Combination Short-haul Truck",
  "Light Commercial Truck",
  "Motorhome - Recreational Vehicle",
  "Motorcycle",
  "Other Buses",
  "Passenger Car",
  "Passenger Truck",
  "Refuse Truck",
  "School Bus",
  "Single Unit Long-haul Truck",
  "Single Unit Short-haul Truck",
  "Transit Bus",
];

const VEHICLE_TYPE_COLORS = [
  "#1f77b4",
  "#ff7f0e",
  "#2ca02c",
  "#d62728",
  "#9467bd",
  "#8c564b",
  "#e377c2",
  "#7f7f7f",
  "#bcbd22",
  "#17becf",
  "#a55194",
  "#393b79",
  "#637939",
];

const EMISSION_TYPES = [
  { label: "CO₂", value: "CO2" },
  { label: "NOₓ", value: "NOx" },
  { label: "PM2.5B", value: "PM2.5B" },
  { label: "PM2.5T", value: "PM2.5T" },
];

// Scenario names from R3 data (same for all states/gases)
const SCENARIO_NAMES = Object.keys(GA_CO2.scenarios || {});

function downloadCsv(cityName, chartMode) {
  const state = CITY_TO_STATE[cityName] || CITY_TO_STATE[cityName?.replace(/\s/g, "")] || null;
  if (!state) return;
  const fileData = DATA_MAP[`${state}_${chartMode}`];
  if (!fileData) return;
  const metrics  = Object.keys(fileData);
  const tractIds = Object.keys(fileData[metrics[0]]?.tracts || {});
  const labels   = fileData[metrics[0]]?.labels || [];
  const header   = ["Label", ...metrics.flatMap(m => tractIds.map(t => `${m}_${t}`))];
  const rows     = labels.map((lbl, i) => [
    lbl, ...metrics.flatMap(m => tractIds.map(t => fileData[m]?.tracts?.[t]?.[i] ?? "")),
  ]);
  const csv  = [header, ...rows].map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = `${cityName}_${chartMode}_emissions.csv`; a.click();
  URL.revokeObjectURL(url);
}

const FinalResultsPage = ({ resultsSelection, setResultsSelection }) => {
  const [dailyAnnualSelection, setDailyAnnualSelection] = useState("DAILY");

  const ConsumptionAndEmissionState = useAppStore((s) => s.ConsumptionAndEmission);
  const setConsumptionAndEmission = useAppStore((s) => s.setConsumptionAndEmission);
  const classificationState = useAppStore((s) => s.classificationState);
  const setClassificationState = useAppStore((s) => s.setClassificationState);

  const cityName     = classificationState.city || classificationState.cityInput;
  const fuelType     = ConsumptionAndEmissionState.FuelType || "";
  const emissionType = ConsumptionAndEmissionState.EmissionType || "";
  const chartMode    = dailyAnnualSelection === "DAILY" ? "R1" : "R2";
  const showVehicle  = resultsSelection === "VEHICLE";
  const showGrid     = resultsSelection === "GRID";

  return (
    <div className="flex flex-col gap-3 w-full max-w-6xl mx-auto h-full">

      {/* ── CONTROL ROW ─────────────────────────────────────────────── */}
      <div className="flex flex-row items-end gap-4 flex-wrap">

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-600">Vehicle / Grid</label>
          <select
            value={resultsSelection}
            onChange={(e) => setResultsSelection(e.target.value)}
            className="border rounded px-3 py-2 w-44 text-sm"
          >
            <option value="">Select Vehicle/Grid</option>
            <option value="VEHICLE">Vehicle</option>
            <option value="GRID">Grid</option>
          </select>
        </div>

        {showVehicle && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-600">Daily / Annual</label>
            <select
              value={dailyAnnualSelection}
              onChange={(e) => setDailyAnnualSelection(e.target.value)}
              className="border rounded px-3 py-2 w-40 text-sm"
            >
              <option value="DAILY">Daily</option>
              <option value="ANNUAL">Annual</option>
            </select>
          </div>
        )}

        {showVehicle && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-600">Fuel Type</label>
            <select
              value={fuelType}
              onChange={(e) => setConsumptionAndEmission({ FuelType: e.target.value })}
              className="border rounded px-3 py-2 w-44 text-sm"
            >
              <option value="">Select Fuel Type</option>
              {FUEL_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        )}

        {showVehicle && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-600">Emission Type</label>
            <select
              value={emissionType}
              onChange={(e) => setConsumptionAndEmission({ EmissionType: e.target.value })}
              className="border rounded px-3 py-2 w-48 text-sm"
            >
              <option value="">Select Emission Type</option>
              {EMISSION_TYPES.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
            </select>
          </div>
        )}

        {/* City dropdown — only for Vehicle mode */}
        {showVehicle && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-600">City</label>
            <select
              value={cityName || ""}
              onChange={(e) => setClassificationState({ city: e.target.value })}
              className="border rounded px-3 py-2 w-40 text-sm"
            >
              <option value="">Select City</option>
              {CITY_OPTIONS.map(c => <option key={c} value={c === "New York" ? "NewYork" : c === "Los Angeles" ? "LosAngeles" : c}>{c}</option>)}
            </select>
          </div>
        )}

        <div className="flex flex-col justify-end">
          <button
            type="button"
            onClick={() => downloadCsv(cityName, chartMode)}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded px-5 py-2 text-sm font-semibold transition-colors"
          >
            DOWNLOAD
          </button>
        </div>
      </div>

      {/* ── CHARTS + LEGEND ─────────────────────────────────────────── */}
      <div className="flex flex-row gap-4 flex-1 min-h-0">

        {/* Charts — left, takes remaining width */}
        <div className="flex-1 min-w-0 flex flex-col gap-8 overflow-auto">

          {showVehicle && (
            <>
              {fuelType && (
                <div className="w-full border border-gray-200 rounded-lg bg-white shadow-sm p-1" style={{ height: 220 }}>
                  <VehicleChartR1R2 metric={fuelType} cityName={cityName} mode={chartMode} />
                </div>
              )}
              {emissionType && (
                <div className="w-full border border-gray-200 rounded-lg bg-white shadow-sm p-1" style={{ height: 220 }}>
                  <VehicleChartR1R2 metric={emissionType} cityName={cityName} mode={chartMode} />
                </div>
              )}
              {!fuelType && !emissionType && (
                <div className="flex items-center justify-center h-40 text-gray-400 text-sm">
                  Select a Fuel Type or Emission Type to view the chart.
                </div>
              )}
            </>
          )}

          {showGrid && (
            <div className="flex flex-col gap-8">
              {["CO2", "CH4", "N2O"].map((e) => (
                <div key={e} className="w-full border border-gray-200 rounded-lg bg-white shadow-sm p-1" style={{ height: 220 }}>
                  <GridChartR3 emissionType={e} cityName={cityName} showLegend={false} />
                </div>
              ))}
            </div>
          )}

          {!resultsSelection && (
            <div className="flex flex-col items-center justify-center flex-1 min-h-[400px] border-2 border-dashed border-gray-200 rounded-xl bg-gray-50">
              <svg className="w-16 h-16 text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className="text-gray-400 text-base font-medium">Select Vehicle or Grid above to view results.</span>
            </div>
          )}
        </div>

        {/* ── RIGHT LEGEND PANEL ──────────────────────────────────────── */}

        {/* Vehicle legend: Vehicle Types */}
        {showVehicle && (
          <div className="flex-shrink-0 w-60 border border-gray-500 rounded-xl bg-white p-3 shadow-md overflow-y-auto self-start">
            <div className="text-sm font-bold text-gray-800 mb-2">Vehicle Types</div>
            {VEHICLE_TYPES.map((name, idx) => (
              <div key={name} className="flex items-center gap-2 py-0.5">
                <svg width="28" height="10" style={{ flexShrink: 0 }}>
                  <line x1="0" y1="5" x2="28" y2="5" stroke={VEHICLE_TYPE_COLORS[idx % VEHICLE_TYPE_COLORS.length]} strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span className="text-[11px] text-gray-700">{name}</span>
              </div>
            ))}
          </div>
        )}

        {/* Grid legend: scenarios — shared across all 3 charts */}
        {showGrid && SCENARIO_NAMES.length > 0 && (
          <div className="flex-shrink-0 w-56 border border-gray-500 rounded-xl bg-white p-3 shadow-md self-start">
            <div className="text-sm font-bold text-gray-800 mb-2">Scenarios</div>
            {SCENARIO_NAMES.map((name, idx) => (
              <div key={name} className="flex items-center gap-2 py-0.5">
                <svg width="28" height="10" style={{ flexShrink: 0 }}>
                  <line x1="0" y1="5" x2="28" y2="5" stroke={SCENARIO_COLORS[idx % SCENARIO_COLORS.length]} strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <span className="text-[11px] text-gray-700">{name}</span>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  );
};

export default FinalResultsPage;
