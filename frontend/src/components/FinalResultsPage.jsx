import useAppStore from "../useAppStore";
import { useState, useRef, useEffect, useCallback } from "react";
import { ReportChatWidget } from "./ReportChat";
import { SCENARIO_COLORS } from "./GridChartR3";
import GridEmissionsChart from "./GridEmissionsChart";
import VehicleChartR1R2, { TRACT_COLORS } from "./VehicleChartR1R2";
import { CITY_TO_STATE } from "../utils/chartConstants";
import downloadPlotsPdf from "../utils/downloadPlotsPdf";

const FUEL_TYPES = ["CNG", "Diesel", "Electricity", "Ethanol", "Gasoline"];

// Static imports as fallback when no generated data exists
import GA_R1 from "../assets/r1r2data/GA_R1.json";
import GA_R2 from "../assets/r1r2data/GA_R2.json";
import CA_R1 from "../assets/r1r2data/CA_R1.json";
import CA_R2 from "../assets/r1r2data/CA_R2.json";
import NY_R1 from "../assets/r1r2data/NY_R1.json";
import NY_R2 from "../assets/r1r2data/NY_R2.json";
import WA_R1 from "../assets/r1r2data/WA_R1.json";
import WA_R2 from "../assets/r1r2data/WA_R2.json";
import { downloadR3CsvAll, R3_DATA_MAP } from "../utils/r3DataUtils";

import GA_GridEmissions from "../assets/r1r2data/GA_GridEmissions.json";
import CA_GridEmissions from "../assets/r1r2data/CA_GridEmissions.json";
const STATIC_GE_MAP = { GA: GA_GridEmissions, CA: CA_GridEmissions };

const STATIC_DATA_MAP = { GA_R1, GA_R2, CA_R1, CA_R2, NY_R1, NY_R2, WA_R1, WA_R2 };

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5003";

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
  { label: "CO\u2082", value: "CO2" },
  { label: "NO\u2093", value: "NOx" },
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


function downloadCsv(cityName, chartMode, dataMap) {
  const state = CITY_TO_STATE[cityName] || CITY_TO_STATE[cityName?.replace(/\s/g, "")] || null;
  if (!state) return;
  const fileData = dataMap[`${state}_${chartMode}`];
  if (!fileData) return;
  const metrics  = Object.keys(fileData).filter(k => k !== "meta" && k !== "byFuel");
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


function downloadGridEmissionsCsv(cityName, geData) {
  if (!geData) return;
  const scenarios = geData.scenarios;
  const scenarioNames = Object.keys(scenarios);
  const gases = ["CO2", "CH4", "N2O"];
  const labels = scenarios[scenarioNames[0]]?.CO2?.labels || [];
  const header = ["Year", ...gases.flatMap(g => scenarioNames.map(s => `${g}_${s}`))];
  const rows = labels.map((yr, i) => [
    yr,
    ...gases.flatMap(g => scenarioNames.map(s => scenarios[s]?.[g]?.studyAreaTotal?.[i] ?? "")),
  ]);
  const csv = [header, ...rows].map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${cityName}_GridEmissions.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Injected keyframe for the indeterminate progress bar
const progressStyle = document.getElementById("gen-progress-style") || (() => {
  const s = document.createElement("style");
  s.id = "gen-progress-style";
  s.textContent = `@keyframes progress { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }`;
  document.head.appendChild(s);
  return s;
})();

const FinalResultsPage = ({ resultsSelection, setResultsSelection, autoGenerate }) => {
  const [dailyAnnualSelection, setDailyAnnualSelection] = useState("DAILY");
  const [selectedScenarioIdx, setSelectedScenarioIdx] = useState(null);
  const [selectedVehicleIdx, setSelectedVehicleIdx] = useState(null);
  const [localFuelType, setLocalFuelType] = useState("");
  const [localEmissionType, setLocalEmissionType] = useState("");
  const [downloadOpen, setDownloadOpen] = useState(false);

  // Runtime-fetched data state
  const [generatedR1, setGeneratedR1] = useState(null);
  const [generatedR2, setGeneratedR2] = useState(null);
  const [generatedGE, setGeneratedGE] = useState(null);
  const [genStatus, setGenStatus] = useState(null); // null | "generating" | "ready" | "failed" | "none"
  const [genError, setGenError] = useState(null);
  const [genVersion, setGenVersion] = useState(null);
  const [r2Meta, setR2Meta] = useState(null); // provenance metadata from R2
  const [serverStale, setServerStale] = useState(false); // server-detected staleness
  const [serverStaleReasons, setServerStaleReasons] = useState([]);

  // Chart refs for PDF export
  const consumptionChartRef = useRef(null);
  const emissionChartRef = useRef(null);
  const geChartCo2Ref = useRef(null);
  const geChartCh4Ref = useRef(null);
  const geChartN2oRef = useRef(null);

  const classificationState = useAppStore((s) => s.classificationState);
  const theme = useAppStore((s) => s.theme);
  const resultsStale = useAppStore((s) => s.resultsStale);
  const markResultsFresh = useAppStore((s) => s.markResultsFresh);
  const computeInputFingerprint = useAppStore((s) => s.computeInputFingerprint);

  const cityName     = classificationState.city || classificationState.cityInput;
  const fuelType     = localFuelType;
  const emissionType = localEmissionType;
  const chartMode    = dailyAnnualSelection === "DAILY" ? "R1" : "R2";
  const showVehicle  = resultsSelection === "VEHICLE";
  const showGrid     = resultsSelection === "GRID";

  const state = CITY_TO_STATE[cityName] || CITY_TO_STATE[cityName?.replace(/\s/g, "")] || null;

  // Check for generated data on mount and when state changes
  const fetchGeneratedData = useCallback(async (st) => {
    if (!st) return;
    try {
      const statusRes = await fetch(`${API_BASE}/api/generated/${st}/_status.json`);
      if (!statusRes.ok) {
        setGenStatus("none");
        return;
      }
      const status = await statusRes.json();
      setGenStatus(status.status);
      setGenVersion(status.version || null);
      setServerStale(!!status.stale);
      setServerStaleReasons(status.staleReasons || []);

      if (status.status !== "ready") return;

      // Fetch R1, R2, and GridEmissions in parallel
      const [r1Res, r2Res, geRes] = await Promise.allSettled([
        fetch(`${API_BASE}/api/generated/${st}/${st}_R1.json`).then(r => r.ok ? r.json() : null),
        fetch(`${API_BASE}/api/generated/${st}/${st}_R2.json`).then(r => r.ok ? r.json() : null),
        fetch(`${API_BASE}/api/generated/${st}/${st}_GridEmissions.json`).then(r => r.ok ? r.json() : null),
      ]);

      const r1 = r1Res.status === "fulfilled" ? r1Res.value : null;
      const r2 = r2Res.status === "fulfilled" ? r2Res.value : null;
      const ge = geRes.status === "fulfilled" ? geRes.value : null;

      setGeneratedR1(r1);
      setGeneratedR2(r2);
      setGeneratedGE(ge);

      // Extract provenance metadata from R2
      if (r2?.meta) {
        setR2Meta(r2.meta);
      }
    } catch {
      setGenStatus("none");
    }
  }, []);

  useEffect(() => {
    fetchGeneratedData(state);
  }, [state, fetchGeneratedData]);

  // Generate Results handler
  const handleGenerateResults = useCallback(async () => {
    if (!state) return;
    setGenStatus("generating");
    setGenError(null);
    try {
      const res = await fetch(`${API_BASE}/api/generate-results`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state, endYear: useAppStore.getState().penetrationState?.projectedYear || undefined }),
      });

      // Handle 409 (busy) — generation already in progress, just poll
      if (res.status === 409) {
        setGenStatus("generating");
        return;
      }

      const data = await res.json();
      if (res.ok && data.status === "success") {
        setGenVersion(data.version);
        // Re-fetch the generated files
        await fetchGeneratedData(state);
        // Post-generation freshness recheck: if inputs changed during generation, don't mark fresh
        if (!data.stale) {
          markResultsFresh(computeInputFingerprint());
        }
      } else {
        setGenStatus("failed");
        setGenError(data.message || "Generation failed");
      }
    } catch (err) {
      setGenStatus("failed");
      setGenError(err.message);
    }
  }, [state, fetchGeneratedData, markResultsFresh, computeInputFingerprint]);

  // Auto-generate results when entering the Results step with stale data
  // Triggers on: Zustand resultsStale (input changes) OR server-detected staleness (manifest vs generated mismatch)
  const lastAutoGenFingerprint = useRef(null);
  useEffect(() => {
    const isStale = resultsStale || serverStale;
    const currentFingerprint = computeInputFingerprint();
    if (autoGenerate && isStale && state && genStatus !== "generating") {
      // Only trigger if fingerprint changed since last auto-gen (prevents infinite loop)
      if (lastAutoGenFingerprint.current !== currentFingerprint) {
        lastAutoGenFingerprint.current = currentFingerprint;
        handleGenerateResults();
      }
    }
    // Reset when autoGenerate becomes false (user navigated away)
    if (!autoGenerate) {
      lastAutoGenFingerprint.current = null;
    }
  }, [autoGenerate, resultsStale, serverStale, state, genStatus, handleGenerateResults, computeInputFingerprint]);

  // Poll _status.json every 5 seconds while on the Results step to detect staleness
  useEffect(() => {
    if (!autoGenerate || !state) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/generated/${state}/_status.json`);
        if (!res.ok) return;
        const status = await res.json();
        setServerStale(!!status.stale);
        setServerStaleReasons(status.staleReasons || []);
        // If status changed from generating to ready, refresh data
        if (status.status === "ready" && genStatus === "generating") {
          await fetchGeneratedData(state);
          if (!status.stale) {
            markResultsFresh(computeInputFingerprint());
          }
        }
        if (status.status !== "generating") {
          setGenStatus(status.status);
        }
      } catch { /* ignore polling errors */ }
    }, 5000);
    return () => clearInterval(interval);
  }, [autoGenerate, state, genStatus, fetchGeneratedData, markResultsFresh, computeInputFingerprint]);

  // Build effective data map: prefer generated data, fall back to static
  const effectiveDataMap = { ...STATIC_DATA_MAP };
  if (state && generatedR1) effectiveDataMap[`${state}_R1`] = generatedR1;
  if (state && generatedR2) effectiveDataMap[`${state}_R2`] = generatedR2;

  const effectiveGEData = (state && generatedGE) ? generatedGE : (state ? STATIC_GE_MAP[state] : null);

  // The data to pass as overrideData to charts (null = use static imports)
  const r1Override = generatedR1 || null;
  const r2Override = generatedR2 || null;
  const vehicleOverride = chartMode === "R1" ? r1Override : r2Override;
  const geOverride = generatedGE || null;

  const isUsingGenerated = genStatus === "ready" && (generatedR1 || generatedR2);

  // Format provenance for a year into a readable sentence
  const formatProvenance = (prov) => {
    if (!prov) return null;
    // Handle legacy string format
    if (typeof prov === "string") return prov;
    // Handle new object format
    const parts = [];

    // Traffic provenance
    if (prov.traffic === "uploaded") {
      parts.push("Uploaded ABM traffic");
    } else if (prov.traffic === "interpolated" && prov.trafficAnchors) {
      parts.push(`Traffic interpolated between ${prov.trafficAnchors[0]} and ${prov.trafficAnchors[1]} ABM datasets`);
    } else if (prov.traffic === "extrapolated" && prov.trafficAnchors) {
      parts.push(`Traffic extrapolated from ${prov.trafficAnchors[0]} and ${prov.trafficAnchors[1]} ABM datasets`);
    } else if (prov.traffic === "constant" && prov.trafficAnchors) {
      parts.push(`Traffic reused from ${prov.trafficAnchors[0]} (single upload)`);
    } else if (prov.traffic) {
      parts.push(`Traffic: ${prov.traffic}`);
    }
    if (prov.trafficWarning) {
      parts.push(`\u26A0 ${prov.trafficWarning}`);
    }

    // VR fleet provenance (new format: vrSource/vrAnchors)
    if (prov.vrSource) {
      const anchors = prov.vrAnchors || [];
      if (prov.vrSource === "uploaded") {
        parts.push(`${anchors[0] || ""} vehicle fleet (uploaded)`);
      } else if (prov.vrSource === "interpolated") {
        parts.push(`Vehicle fleet interpolated between ${anchors[0]} and ${anchors[1]}`);
      } else if (prov.vrSource === "extrapolated") {
        parts.push(`Vehicle fleet extrapolated from ${anchors[0]} and ${anchors[1]}`);
      } else if (prov.vrSource === "constant") {
        parts.push(`Vehicle fleet reused from ${anchors[0]} (single upload)`);
      }
    } else if (prov.vrYear != null) {
      // Legacy format backward compat
      if (prov.vrCarriedForward) {
        parts.push(`${prov.vrYear} vehicle fleet carried forward`);
      } else {
        parts.push(`${prov.vrYear} vehicle fleet`);
      }
    }
    if (prov.vrWarning) {
      parts.push(`\u26A0 ${prov.vrWarning}`);
    }

    return parts.join(", ") || null;
  };

  // Provenance label for a year
  const getProvenanceLabel = (year) => {
    if (!r2Meta?.yearProvenance) return null;
    return r2Meta.yearProvenance[String(year)] || null;
  };

  // Provenance expanded state
  const [provenanceOpen, setProvenanceOpen] = useState(false);

  // Whether we have any previous data to show (generated or static fallback)
  const hasPreviousData = !!(generatedR1 || generatedR2 || state);
  const isGenerating = genStatus === "generating";
  // Charts should appear dimmed when generating AND we have old data to show
  const chartsOutdated = isGenerating && hasPreviousData;

  return (
    <div className="flex flex-col gap-3 w-full max-w-6xl mx-auto h-full relative">

      {/* ── TOP PROGRESS BAR (non-blocking) ──────────────────────────── */}
      {isGenerating && (
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-2 animate-in">
          <div className="w-4 h-4 border-2 border-green-300 border-t-green-600 rounded-full animate-spin flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-green-800">Updating results...</div>
            <div className="text-xs text-green-600">Running ML models for {state}. Charts will refresh automatically.</div>
          </div>
          {/* Subtle indeterminate progress bar */}
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-100 rounded-b-lg overflow-hidden">
            <div className="h-full w-1/3 bg-green-500 rounded-full animate-[progress_1.5s_ease-in-out_infinite]" />
          </div>
        </div>
      )}

      {/* ── GENERATION FAILED BANNER ──────────────────────────────────── */}
      {genStatus === "failed" && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">
          <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-red-800">Generation failed</div>
            <div className="text-xs text-red-600">{genError || "An unexpected error occurred."}</div>
          </div>
          <button
            type="button"
            onClick={handleGenerateResults}
            className="px-3 py-1 rounded text-xs font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors flex-shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── STALE RESULTS WARNING (only when NOT already regenerating) ── */}
      {(resultsStale || serverStale) && !isGenerating && genStatus !== "failed" && (generatedR1 || generatedR2) && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-300 rounded-lg px-4 py-2 text-amber-800 text-sm">
          <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
          <div>
            <strong>Results may be outdated.</strong> Input data has changed since these results were generated.
            {serverStaleReasons.length > 0 && (
              <ul className="mt-1 list-disc list-inside text-xs text-amber-700">
                {serverStaleReasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ── STATUS BAR ────────────────────────────────────────────────── */}
      {state && genStatus !== "generating" && genStatus !== "failed" && (
        <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2">
          {/* Status indicator */}
          <div className="text-xs text-gray-500 flex items-center gap-2">
            {genStatus === "ready" && isUsingGenerated && (
              <span className="flex items-center gap-1.5 text-green-600 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                Using generated results
              </span>
            )}
            {genStatus === "ready" && !isUsingGenerated && (
              <span className="text-yellow-600 font-medium">Generated data available (using static fallback)</span>
            )}
            {genStatus === "none" && (
              <span className="text-gray-400">No generated results — using pre-built data</span>
            )}
          </div>

          {/* Provenance summary */}
          {r2Meta && (
            <div className="ml-auto text-[10px] text-gray-400 flex gap-3">
              {r2Meta.anchorYears?.length > 0 && (
                <span>ABM Anchors: {r2Meta.anchorYears.join(", ")}</span>
              )}
              {r2Meta.vrAnchorYears?.length > 0 && (
                <span>Fleet Years: {r2Meta.vrAnchorYears.join(", ")}</span>
              )}
              {r2Meta.yearRange && (
                <span>Range: {r2Meta.yearRange[0]}–{r2Meta.yearRange[1]}</span>
              )}
            </div>
          )}

          {/* Regeneration is fully automatic — no manual button needed */}
        </div>
      )}

      {/* ── CONTROL ROW ─────────────────────────────────────────────── */}
      <div className="flex flex-row items-end gap-4 flex-wrap">

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-600">Vehicle / Power Grid</label>
          <select
            value={resultsSelection}
            onChange={(e) => setResultsSelection(e.target.value)}
            className="border rounded px-3 py-2 w-44 text-sm"
          >
            <option value="">Vehicle/Power Grid</option>
            <option value="VEHICLE">Vehicle</option>
            <option value="GRID">Power Grid</option>
          </select>
        </div>

        {showVehicle && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-600">Hourly / Monthly</label>
            <select
              value={dailyAnnualSelection}
              onChange={(e) => setDailyAnnualSelection(e.target.value)}
              className="border rounded px-3 py-2 w-40 text-sm"
            >
              <option value="DAILY">Hourly</option>
              <option value="ANNUAL">Monthly</option>
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
                    if (showVehicle) downloadCsv(cityName, chartMode, effectiveDataMap);
                    else if (showGrid) downloadGridEmissionsCsv(cityName, effectiveGEData);
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
                      if (c1) charts.push({ chart: c1, title: `${fuelType} Consumption (${chartMode === "R1" ? "Hourly" : "Annual"})` });
                      const c2 = emissionChartRef.current?.getChart();
                      if (c2) charts.push({ chart: c2, title: `${emissionType} Emission (${chartMode === "R1" ? "Hourly" : "Annual"})` });
                    } else if (showGrid) {
                      const c1 = geChartCo2Ref.current?.getChart();
                      if (c1) charts.push({ chart: c1, title: "Provisional CO\u2082 Grid Emissions" });
                      const c2 = geChartCh4Ref.current?.getChart();
                      if (c2) charts.push({ chart: c2, title: "Provisional CH\u2084 Grid Emissions" });
                      const c3 = geChartN2oRef.current?.getChart();
                      if (c3) charts.push({ chart: c3, title: "Provisional N\u2082O Grid Emissions" });
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

          {/* Data Provenance Panel (Annual view) */}
          {showVehicle && dailyAnnualSelection === "ANNUAL" && r2Meta?.yearProvenance && (
            <div className="border border-gray-200 rounded-lg bg-white shadow-sm">
              <button
                type="button"
                onClick={() => setProvenanceOpen(!provenanceOpen)}
                className="w-full flex items-center justify-between px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                <span>Data Provenance</span>
                <svg className={`w-4 h-4 transition-transform ${provenanceOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {provenanceOpen && (
                <div className="px-4 pb-3 text-xs text-gray-600 space-y-1 border-t border-gray-100 pt-2">
                  {Object.entries(r2Meta.yearProvenance).sort(([a],[b]) => Number(a)-Number(b)).map(([year, prov]) => {
                    const label = formatProvenance(prov);
                    return label ? (
                      <div key={year}>
                        <strong>{year}</strong>: {label}.
                      </div>
                    ) : null;
                  })}
                  {r2Meta.modelingAssumptions && (
                    <div className="mt-2 pt-2 border-t border-gray-100 text-[10px] text-gray-400">
                      {r2Meta.modelingAssumptions.map((a, i) => <div key={i}>{a}</div>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {showVehicle && (
            <>
              {fuelType ? (
                <div className={`w-full border rounded-lg bg-white shadow-sm p-3 relative transition-all duration-300 ${chartsOutdated ? "border-amber-300" : "border-gray-200"}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-gray-500">{fuelType} Consumption</span>
                    {chartsOutdated && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                        Outdated — updating
                      </span>
                    )}
                  </div>
                  <div style={{ height: 280 }} className={chartsOutdated ? "opacity-50 pointer-events-none transition-opacity duration-300" : "transition-opacity duration-300"}>
                    <VehicleChartR1R2 ref={consumptionChartRef} metric={fuelType} cityName={cityName} mode={chartMode} controlledIdx={selectedVehicleIdx} onSelectIdx={setSelectedVehicleIdx} overrideData={vehicleOverride} />
                  </div>
                </div>
              ) : isGenerating && !hasPreviousData ? (
                <div className="w-full border border-gray-200 rounded-lg bg-gray-50 p-3 flex flex-col items-center justify-center gap-2" style={{ height: 280 }}>
                  <div className="w-6 h-6 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
                  <span className="text-gray-400 text-sm">Generating consumption chart...</span>
                </div>
              ) : (
                <div className="w-full border border-dashed border-gray-300 rounded-lg bg-gray-50 p-3 flex items-center justify-center" style={{ height: 280 }}>
                  <span className="text-gray-400 text-sm">Select a Fuel Type to view the consumption chart.</span>
                </div>
              )}
              {emissionType ? (
                <div className={`w-full border rounded-lg bg-white shadow-sm p-3 relative transition-all duration-300 ${chartsOutdated ? "border-amber-300" : "border-gray-200"}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-gray-500">
                      {emissionType === "CO2" ? "CO\u2082" : emissionType === "NOx" ? "NO\u2093" : emissionType} Emission{fuelType ? ` (${fuelType})` : ""}
                    </span>
                    {chartsOutdated && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                        Outdated — updating
                      </span>
                    )}
                  </div>
                  <div style={{ height: 280 }} className={chartsOutdated ? "opacity-50 pointer-events-none transition-opacity duration-300" : "transition-opacity duration-300"}>
                    <VehicleChartR1R2 ref={emissionChartRef} metric={emissionType} cityName={cityName} mode={chartMode} fuelFilter={fuelType || null} controlledIdx={selectedVehicleIdx} onSelectIdx={setSelectedVehicleIdx} overrideData={vehicleOverride} />
                  </div>
                </div>
              ) : isGenerating && !hasPreviousData ? (
                <div className="w-full border border-gray-200 rounded-lg bg-gray-50 p-3 flex flex-col items-center justify-center gap-2" style={{ height: 280 }}>
                  <div className="w-6 h-6 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin" />
                  <span className="text-gray-400 text-sm">Generating emission chart...</span>
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
              {[{type:"CO2",title:"Provisional CO\u2082 Grid Emissions",ref:geChartCo2Ref},{type:"CH4",title:"Provisional CH\u2084 Grid Emissions",ref:geChartCh4Ref},{type:"N2O",title:"Provisional N\u2082O Grid Emissions",ref:geChartN2oRef}].map((e) => (
                <div key={e.type} className="flex flex-row gap-4">
                  <div className="flex-1 min-w-0 p-3 rounded-lg bg-gray-50">
                    <div className="text-xs font-semibold text-gray-500 mb-1">{e.title}</div>
                    <div style={{ height: 280 }}>
                      <GridEmissionsChart ref={e.ref} emissionType={e.type} cityName={cityName} showLegend={false} controlledIdx={selectedScenarioIdx} onSelect={setSelectedScenarioIdx} overrideData={geOverride} />
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
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800 leading-relaxed">
                <span className="font-semibold">&#8505; Provisional estimate:</span> annual EV electricity demand &times; Cambium marginal rates
                (12-month average, assuming uniform monthly demand). MOVES energy boundary for
                electricity unconfirmed. Charging-time profiles and charger losses not included.
                Tract demand estimates lack lane-miles.
              </div>
            </div>
          )}

          {!resultsSelection && (
            <div className="flex flex-col items-center justify-center flex-1 min-h-[400px] border-2 border-dashed border-gray-200 rounded-xl bg-gray-50">
              {isGenerating && !hasPreviousData ? (
                <>
                  <div className="w-10 h-10 border-3 border-gray-200 border-t-green-600 rounded-full animate-spin mb-4" />
                  <span className="text-gray-500 text-base font-medium">Generating results for {state}...</span>
                  <span className="text-gray-400 text-sm mt-1">Select Vehicle or Grid above to view charts once ready.</span>
                </>
              ) : (
                <>
                  <svg className="w-16 h-16 text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  <span className="text-gray-400 text-base font-medium">Select Vehicle or Grid above to view results.</span>
                </>
              )}
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
        co2ChartRef={geChartCo2Ref}
        ch4ChartRef={geChartCh4Ref}
        n2oChartRef={geChartN2oRef}
        cityName={cityName}
        r1r2DataMap={effectiveDataMap}
        r3DataMap={R3_DATA_MAP}
      />
    </div>
  );
};

export default FinalResultsPage;
