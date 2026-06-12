import useAppStore from "../useAppStore";
import { useState, useRef } from "react";
import { ReportChatWidget } from "./ReportChat";
import GridChartR3, { SCENARIO_COLORS } from "./GridChartR3";
import VehicleChartR1R2, { TRACT_COLORS } from "./VehicleChartR1R2";
import { CITY_TO_STATE } from "../utils/chartConstants";
import downloadPlotsPdf from "../utils/downloadPlotsPdf";

const FUEL_TYPES = ["CNG", "Diesel", "Electricity", "Ethanol", "Gasoline"];

import GA_R1 from "../assets/r1r2data/GA_R1.json";
import GA_R2 from "../assets/r1r2data/GA_R2.json";
import CA_R1 from "../assets/r1r2data/CA_R1.json";
import CA_R2 from "../assets/r1r2data/CA_R2.json";
import NY_R1 from "../assets/r1r2data/NY_R1.json";
import NY_R2 from "../assets/r1r2data/NY_R2.json";
import WA_R1 from "../assets/r1r2data/WA_R1.json";
import WA_R2 from "../assets/r1r2data/WA_R2.json";
import { downloadR3CsvAll, R3_DATA_MAP } from "../utils/r3DataUtils";

const DATA_MAP = { GA_R1, GA_R2, CA_R1, CA_R2, NY_R1, NY_R2, WA_R1, WA_R2 };

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

// Full display names for scenarios (JSON keys are truncated)
const SCENARIO_NAMES = [
  "Mid-case Scenario",
  "Low Renewable Energy and Battery Costs",
  "High Renewable Energy and Battery Costs",
  "High Demand Growth",
  "Low Natural Gas Prices",
  "High Natural Gas Prices",
  "Low RE & Battery Costs + High Gas Prices",
  "High RE & Battery Costs + Low Gas Prices",
];

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
  a.href = url;
  a.download = `${cityName}_${chartMode}_emissions.csv`;
  a.click();
  URL.revokeObjectURL(url);
}


const FinalResultsPage = ({ resultsSelection, setResultsSelection }) => {
  const [dailyAnnualSelection, setDailyAnnualSelection] = useState("DAILY");
  const [selectedScenarioIdx, setSelectedScenarioIdx] = useState(null);
  const [selectedVehicleIdx, setSelectedVehicleIdx] = useState(null);
  const [localFuelType, setLocalFuelType] = useState("");
  const [localEmissionType, setLocalEmissionType] = useState("");
  const [downloadOpen, setDownloadOpen] = useState(false);

  // Chart refs for PDF export
  const consumptionChartRef = useRef(null);
  const emissionChartRef = useRef(null);
  const co2ChartRef = useRef(null);
  const ch4ChartRef = useRef(null);
  const n2oChartRef = useRef(null);

  const classificationState = useAppStore((s) => s.classificationState);
  const theme = useAppStore((s) => s.theme);

  const cityName     = classificationState.city || classificationState.cityInput;
  const fuelType     = localFuelType;
  const emissionType = localEmissionType;
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
              onChange={(e) => setLocalFuelType(e.target.value)}
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
              onChange={(e) => setLocalEmissionType(e.target.value)}
              className="border rounded px-3 py-2 w-48 text-sm"
            >
              <option value="">Select Emission Type</option>
              {EMISSION_TYPES.map(e => (
                <option key={e.value} value={e.value}>{e.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* City dropdown — disabled, from main (theme-aware) */}
        {showVehicle && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-600">City</label>
            <select
              disabled
              className={`border rounded px-3 py-2 w-40 text-sm bg-gray-300 cursor-not-allowed ${
                theme === "dark"
                  ? "bg-[#18181b] text-white border-gray-700"
                  : "text-gray-700 border-gray-400"
              }`}
            >
              <option>{cityName || "City"}</option>
            </select>
          </div>
        )}

        {/* Download dropdown */}
        {(showVehicle || showGrid) && (
          <div className="flex flex-col justify-end relative">
            <button
              type="button"
              onClick={() => setDownloadOpen((v) => !v)}
              onBlur={() => setTimeout(() => setDownloadOpen(false), 150)}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded px-5 py-2 text-sm font-semibold transition-colors"
            >
              DOWNLOAD
              <svg className="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {downloadOpen && (
              <div className="absolute top-full mt-1 right-0 bg-white border border-gray-200 rounded shadow-lg z-50 min-w-[150px]">
                <button
                  type="button"
                  className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100"
                  onMouseDown={() => {
                    if (showVehicle) downloadCsv(cityName, chartMode);
                    else downloadR3CsvAll(cityName);
                    setDownloadOpen(false);
                  }}
                >
                  CSV Data
                </button>
                <button
                  type="button"
                  className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100"
                  onMouseDown={() => {
                    const charts = [];
                    if (showVehicle) {
                      const c1 = consumptionChartRef.current?.getChart();
                      if (c1) charts.push({ chart: c1, title: `${fuelType} Consumption (${chartMode === "R1" ? "Daily" : "Annual"})` });
                      const c2 = emissionChartRef.current?.getChart();
                      if (c2) charts.push({ chart: c2, title: `${emissionType} Emission (${chartMode === "R1" ? "Daily" : "Annual"})` });
                    } else {
                      const c1 = co2ChartRef.current?.getChart();
                      if (c1) charts.push({ chart: c1, title: "CO\u2082 Emission" });
                      const c2 = ch4ChartRef.current?.getChart();
                      if (c2) charts.push({ chart: c2, title: "CH\u2084 Emission" });
                      const c3 = n2oChartRef.current?.getChart();
                      if (c3) charts.push({ chart: c3, title: "N\u2082O Emission" });
                    }
                    downloadPlotsPdf(charts, `${cityName || "charts"}_plots.pdf`);
                    setDownloadOpen(false);
                  }}
                >
                  Plots (PDF)
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── CHARTS + LEGEND ─────────────────────────────────────────── */}
      <div className="flex flex-row gap-4 flex-1 min-h-0">

        {/* Charts — left, takes remaining width */}
        <div className="flex-1 min-w-0 flex flex-col gap-8 overflow-auto">

          {showVehicle && (
            <>
              {fuelType ? (
                <div className="w-full border border-gray-200 rounded-lg bg-white shadow-sm p-3">
                  <div className="text-xs font-semibold text-gray-500 mb-1">{fuelType} Consumption</div>
                  <div style={{ height: 280 }}>
                    <VehicleChartR1R2 ref={consumptionChartRef} metric={fuelType} cityName={cityName} mode={chartMode} controlledIdx={selectedVehicleIdx} onSelectIdx={setSelectedVehicleIdx} />
                  </div>
                </div>
              ) : (
                <div className="w-full border border-dashed border-gray-300 rounded-lg bg-gray-50 p-3 flex items-center justify-center" style={{ height: 280 }}>
                  <span className="text-gray-400 text-sm">Select a Fuel Type to view the consumption chart.</span>
                </div>
              )}
              {emissionType ? (
                <div className="w-full border border-gray-200 rounded-lg bg-white shadow-sm p-3">
                  <div className="text-xs font-semibold text-gray-500 mb-1">
                    {emissionType === "CO2" ? "CO\u2082" : emissionType === "NOx" ? "NO\u2093" : emissionType} Emission
                  </div>
                  <div style={{ height: 280 }}>
                    <VehicleChartR1R2 ref={emissionChartRef} metric={emissionType} cityName={cityName} mode={chartMode} controlledIdx={selectedVehicleIdx} onSelectIdx={setSelectedVehicleIdx} />
                  </div>
                </div>
              ) : (
                <div className="w-full border border-dashed border-gray-300 rounded-lg bg-gray-50 p-3 flex items-center justify-center" style={{ height: 280 }}>
                  <span className="text-gray-400 text-sm">Select an Emission Type to view the emission chart.</span>
                </div>
              )}
            </>
          )}

          {showGrid && (
            <div className="flex flex-col gap-8">
              {[
                { type: "CO2", title: "CO\u2082", ref: co2ChartRef },
                { type: "CH4", title: "CH\u2084", ref: ch4ChartRef },
                { type: "N2O", title: "N\u2082O", ref: n2oChartRef },
              ].map((e) => (
                <div key={e.type} className="flex flex-row gap-4">
                  <div className="flex-1 min-w-0 p-3 rounded-lg bg-gray-50">
                    <div className="text-xs font-semibold text-gray-500 mb-1">{e.title}</div>
                    <div style={{ height: 280 }}>
                      <GridChartR3 ref={e.ref} emissionType={e.type} cityName={cityName} showLegend={false} controlledIdx={selectedScenarioIdx} onSelect={setSelectedScenarioIdx} />
                    </div>
                  </div>
                  {SCENARIO_NAMES.length > 0 && (
                    <div className="flex-shrink-0 border border-gray-500 rounded-xl bg-white p-3 shadow-md self-center">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-bold text-gray-800">Scenarios</span>
                        {selectedScenarioIdx !== null && (
                          <button type="button" onClick={() => setSelectedScenarioIdx(null)} className="text-[9px] text-blue-500 hover:text-blue-700 font-semibold">Clear</button>
                        )}
                      </div>
                      {SCENARIO_NAMES.map((name, idx) => {
                        const isSelected = selectedScenarioIdx === idx;
                        const isFaded = selectedScenarioIdx !== null && !isSelected;
                        return (
                          <button key={name} type="button"
                            onClick={() => setSelectedScenarioIdx(selectedScenarioIdx === idx ? null : idx)}
                            className="flex items-center gap-2 py-0.5 w-full hover:opacity-80 transition-opacity"
                            style={{ opacity: isFaded ? 0.28 : 1 }}>
                            <svg width="28" height="10" style={{ flexShrink: 0 }}>
                              <line x1="0" y1="5" x2="28" y2="5" stroke={SCENARIO_COLORS[idx % SCENARIO_COLORS.length]} strokeWidth={isSelected ? 2.5 : 1.5} strokeLinecap="round" />
                            </svg>
                            <span className={`text-[11px] text-left whitespace-nowrap ${isSelected ? "font-bold text-gray-900" : "font-bold text-gray-700"}`}>{name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
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

        {/* Vehicle: info panel + Vehicle Types legend */}
        {showVehicle && (
          <div className="flex flex-col gap-3 flex-shrink-0 w-60 self-center">
            {/* Vehicle Types legend (user's addition) */}
            <div className="border border-gray-500 rounded-xl bg-white p-3 shadow-md overflow-y-auto">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-bold text-gray-800">Vehicle Types</span>
                {selectedVehicleIdx !== null && (
                  <button type="button" onClick={() => setSelectedVehicleIdx(null)} className="text-[9px] text-blue-500 hover:text-blue-700 font-semibold">Clear</button>
                )}
              </div>
              {VEHICLE_TYPES.map((name, idx) => {
                const isSelected = selectedVehicleIdx === idx;
                const isFaded = selectedVehicleIdx !== null && !isSelected;
                return (
                  <button key={name} type="button"
                    onClick={() => setSelectedVehicleIdx(selectedVehicleIdx === idx ? null : idx)}
                    className="flex items-center gap-2 py-0.5 w-full hover:opacity-80 transition-opacity"
                    style={{ opacity: isFaded ? 0.28 : 1 }}>
                    <svg width="28" height="10" style={{ flexShrink: 0 }}>
                      <line x1="0" y1="5" x2="28" y2="5" stroke={TRACT_COLORS[idx % TRACT_COLORS.length]} strokeWidth={isSelected ? 2.5 : 1.5} strokeLinecap="round" />
                    </svg>
                    <span className={`text-[11px] text-left ${isSelected ? "font-bold text-gray-900" : "font-bold text-gray-700"}`}>{name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}


      </div>

      {/* AI Report Chat Widget */}
      <ReportChatWidget
        resultsSelection={resultsSelection}
        fuelType={fuelType}
        emissionType={emissionType}
        chartMode={chartMode}
        consumptionChartRef={consumptionChartRef}
        emissionChartRef={emissionChartRef}
        co2ChartRef={co2ChartRef}
        ch4ChartRef={ch4ChartRef}
        n2oChartRef={n2oChartRef}
      />
    </div>
  );
};

export default FinalResultsPage;
