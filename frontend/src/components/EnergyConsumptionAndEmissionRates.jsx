import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import useAppStore from "../useAppStore";
import { API_URL } from "../config";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
} from "chart.js";
import zoomPlugin from "chartjs-plugin-zoom";
import { chartBgPlugin, subGridThirdsXPlugin } from "../utils/chartConstants";

ChartJS.register(LinearScale, PointElement, LineElement, Title, Tooltip, zoomPlugin);

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

const FUEL_TYPES = [
  "Compressed Natural Gas - CNG",
  "Diesel Fuel",
  "Electricity",
  "Ethanol - E-85",
  "Gasoline",
];

const EMISSION_TYPES = [
  { label: "CO\u2082 Emissions", value: "CO\u2082 Emissions", backend: "CO2 Emissions", unit: "g/mi" },
  { label: "Energy Rate", value: "Energy Rate", backend: "Energy Rate", unit: "MWh/mile" },
  { label: "NO\u2093", value: "NO\u2093", backend: "NOx", unit: "g/mi" },
  { label: "PM2.5 Brake Wear", value: "PM2.5 Brake Wear", backend: "PM2.5 Brake Wear", unit: "g/mi" },
  { label: "PM2.5 Tire Wear", value: "PM2.5 Tire Wear", backend: "PM2.5 Tire Wear", unit: "g/mi" },
];

const VEHICLE_COLORS = [
  "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
  "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf",
  "#a55194", "#393b79", "#637939",
];

const CITY_NAME_MAP = {
  LosAngeles: "Los Angeles",
  "Los Angeles": "Los Angeles",
  NewYork: "NewYork",
  Atlanta: "Atlanta",
  Seattle: "Seattle",
};

// Inline zoom toolbar — sits in the chart header row, no absolute positioning
const ZoomToolbar = ({ chartRef }) => (
  <div className="flex bg-white rounded border border-gray-300 shadow-sm overflow-hidden select-none shrink-0">
    <button onClick={() => chartRef.current?.zoom(1.1)} className="px-2.5 py-1 text-blue-600 hover:bg-gray-50 border-r border-gray-200 text-base font-bold leading-none transition-colors" title="Zoom In" type="button">+</button>
    <button onClick={() => chartRef.current?.zoom(0.9)} className="px-2.5 py-1 text-blue-600 hover:bg-gray-50 border-r border-gray-200 text-base font-bold leading-none transition-colors" title="Zoom Out" type="button">-</button>
    <button onClick={() => chartRef.current?.resetZoom()} className="px-2.5 py-1 text-[10px] font-semibold text-blue-600 hover:bg-gray-50 uppercase tracking-wide transition-colors" title="Reset Zoom" type="button">Reset</button>
  </div>
);

// Robust JSON parse — backend sometimes returns NaN tokens
function parseRobustJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(text.replace(/\bNaN\b/g, "null"));
  }
}

async function fetchConsumption(vehicleType, fuelType, vehicleAge, city, signal) {
  const res = await fetch(`${API_URL}/predict_consumption`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fuelType, vehicleAge, city, vehicleType }),
    signal,
  });
  if (!res.ok) throw new Error(`Consumption API error ${res.status}`);
  const data = parseRobustJSON(await res.text());
  if (!Array.isArray(data)) throw new Error("Consumption response is not an array");
  const results = data.map((item) => ({
    speed: item.speed,
    consumption: item.fuel_consumption ?? item.energy_consumption_mwh_mile,
    unit: item.fuel_unit || item.energy_unit,
  }));
  return {
    results,
    unit: results[0]?.unit || "units",
    emissionType: "Fuel Consumption",
  };
}

async function fetchEmissions(vehicleType, fuelType, vehicleAge, city, emissionBackend, emissionLabel, signal) {
  const res = await fetch(`${API_URL}/predict_emissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ City: city, FuelType: fuelType, VehicleType: vehicleType, Age: parseInt(vehicleAge), EmissionType: emissionBackend }),
    signal,
  });
  if (!res.ok) throw new Error(`Emission API error ${res.status}`);
  const data = parseRobustJSON(await res.text());
  if (!Array.isArray(data)) throw new Error("Emissions response is not an array");
  return {
    results: data.map((item) => ({ speed: item.Speed, prediction: item.PredictedValue })),
    unit: data[0]?.Unit || "g/mi",
    prediction_type: data[0]?.EmissionType || emissionLabel,
    emissionType: emissionLabel,
  };
}

export default function EnergyConsumptionAndEmissionRates() {
  const consumptionChartRef = useRef(null);
  const emissionChartRef = useRef(null);

  // Store slices
  const classificationState = useAppStore((s) => s.classificationState);
  const ConsumptionAndEmissionState = useAppStore((s) => s.ConsumptionAndEmission);
  const setConsumptionAndEmissionState = useAppStore((s) => s.setConsumptionAndEmission);
  const vehicleData = useAppStore((s) => s.vehicleData);
  const setVehicleData = useAppStore((s) => s.setVehicleData);

  // Interactive legend state
  const [hoveredVehicle, setHoveredVehicle] = useState(null);
  const [pinnedVehicle, setPinnedVehicle] = useState(null);
  const pinnedVehicleRef = useRef(null);
  useEffect(() => { pinnedVehicleRef.current = pinnedVehicle; }, [pinnedVehicle]);
  const activeVehicle = hoveredVehicle || pinnedVehicle;

  // Loading progress
  const [loading, setLoading] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  // Track last-fetched params to skip redundant requests
  const lastFetchRef = useRef({ fuelType: null, emissionType: null, vehicleAge: null, city: null });
  const abortRef = useRef(null);
  const autoInitRef = useRef(false);

  // Default filter values used when user hasn't selected (charts render immediately)
  const DEFAULT_FUEL = "Gasoline";
  const DEFAULT_EMISSION = "CO₂ Emissions";
  const DEFAULT_AGE = "1";

  // Auto-trigger initial fetch on mount with defaults
  useEffect(() => {
    if (autoInitRef.current) return;
    autoInitRef.current = true;

    // Set defaults if not already set, triggering the fetch
    const updates = {};
    if (!ConsumptionAndEmissionState.FuelType) updates.FuelType = DEFAULT_FUEL;
    if (!ConsumptionAndEmissionState.EmissionType) updates.EmissionType = DEFAULT_EMISSION;
    if (!ConsumptionAndEmissionState.VehicleAge) updates.VehicleAge = DEFAULT_AGE;

    if (Object.keys(updates).length > 0) {
      setConsumptionAndEmissionState(updates);
    }
  }, [ConsumptionAndEmissionState, setConsumptionAndEmissionState]);

  // Derived params
  const fuelType = ConsumptionAndEmissionState.FuelType || "";
  const emissionType = ConsumptionAndEmissionState.EmissionType || "";
  const vehicleAge = ConsumptionAndEmissionState.VehicleAge || "";
  const rawCity = classificationState.city || classificationState.cityInput;
  const city = CITY_NAME_MAP[rawCity] || rawCity;
  const selectedEmissionTypeObj = EMISSION_TYPES.find((et) => et.value === emissionType || et.label === emissionType) || {};
  const emissionBackend = selectedEmissionTypeObj.backend || "";

  const ageOptions = useMemo(() => Array.from({ length: 30 }, (_, i) => i + 1), []);

  // Filter emission types based on fuel (Electricity hides CO2 and NOx)
  const availableEmissionTypes = useMemo(() => {
    const forbidden = fuelType === "Electricity" ? new Set(["CO2 Emissions", "NOx"]) : new Set();
    return EMISSION_TYPES.filter((et) => et.value !== "Energy Rate" && !forbidden.has(et.backend));
  }, [fuelType]);

  // Clear invalid emission type when fuel changes to Electricity
  const prevFuelTypeRef = useRef(fuelType);
  useEffect(() => {
    if (!emissionType) {
      prevFuelTypeRef.current = fuelType;
      return;
    }
    if (prevFuelTypeRef.current !== fuelType) {
      const currentObj = EMISSION_TYPES.find((et) => et.value === emissionType);
      const forbidden = fuelType === "Electricity" ? new Set(["CO2 Emissions", "NOx"]) : new Set();
      if ((currentObj && forbidden.has(currentObj.backend)) || emissionType === "Energy Rate") {
        setConsumptionAndEmissionState({ EmissionType: "" });
      }
    }
    prevFuelTypeRef.current = fuelType;
  }, [fuelType, emissionType, setConsumptionAndEmissionState]);

  // Auto-trigger: fetch all vehicle types in parallel when params change
  useEffect(() => {
    if (!fuelType || !emissionType || !vehicleAge || !city || !emissionBackend) return;

    const last = lastFetchRef.current;
    const fuelChanged = fuelType !== last.fuelType;
    const emissionChanged = emissionType !== last.emissionType;
    const ageChanged = vehicleAge !== last.vehicleAge;
    const cityChanged = city !== last.city;

    console.log("[Chart Fetch] Params:", { fuelType, emissionType, vehicleAge, city });
    console.log("[Chart Fetch] Changed:", { fuelChanged, emissionChanged, ageChanged, cityChanged });

    if (!fuelChanged && !emissionChanged && !ageChanged && !cityChanged) return;

    console.log("[Chart Fetch] Triggering fetch for age:", vehicleAge);

    const shouldFetchConsumption = fuelChanged || ageChanged || cityChanged;
    const shouldFetchEmissions = emissionChanged || ageChanged || cityChanged || fuelChanged;

    // Abort in-flight requests
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Clear stale data, preserve what won't be refetched
    setVehicleData((prev) => {
      const preserved = {};
      if (!shouldFetchConsumption && prev) {
        Object.entries(prev).forEach(([k, v]) => {
          if (k.endsWith("_Consumption")) preserved[k] = v;
        });
      }
      if (!shouldFetchEmissions && prev) {
        Object.entries(prev).forEach(([k, v]) => {
          if (k.endsWith("_Selected")) preserved[k] = v;
        });
      }
      return preserved;
    });

    const total = VEHICLE_TYPES.length * ((shouldFetchConsumption ? 1 : 0) + (shouldFetchEmissions ? 1 : 0));
    setTotalCount(total);
    setLoadedCount(0);
    setLoading(true);

    // Fire ALL requests in parallel — each updates the store on completion (progressive rendering)
    const promises = [];
    VEHICLE_TYPES.forEach((vt) => {
      if (shouldFetchConsumption) {
        promises.push(
          fetchConsumption(vt, fuelType, vehicleAge, city, controller.signal)
            .then((data) => {
              if (!controller.signal.aborted) {
                setVehicleData((prev) => ({ ...prev, [`${vt}_Consumption`]: data }));
                setLoadedCount((c) => c + 1);
              }
            })
            .catch((err) => {
              if (!controller.signal.aborted) {
                console.error(`Consumption failed for ${vt}:`, err.message);
                setLoadedCount((c) => c + 1);
              }
            })
        );
      }
      if (shouldFetchEmissions) {
        promises.push(
          fetchEmissions(vt, fuelType, vehicleAge, city, emissionBackend, emissionType, controller.signal)
            .then((data) => {
              if (!controller.signal.aborted) {
                setVehicleData((prev) => ({ ...prev, [`${vt}_Selected`]: data }));
                setLoadedCount((c) => c + 1);
              }
            })
            .catch((err) => {
              if (!controller.signal.aborted) {
                console.error(`Emission failed for ${vt}:`, err.message);
                setLoadedCount((c) => c + 1);
              }
            })
        );
      }
    });

    Promise.allSettled(promises).then(() => {
      if (!controller.signal.aborted) {
        setLoading(false);
        lastFetchRef.current = { fuelType, emissionType, vehicleAge, city };
      }
    });

    return () => controller.abort();
  }, [fuelType, emissionType, vehicleAge, city, emissionBackend, setVehicleData]);

  // Build chart datasets from vehicleData (pure derivation, no intermediate state)
  const { consumptionChartData, emissionChartData, consumptionUnit, emissionUnit, consumptionYMax, emissionYMax } = useMemo(() => {
    const colorMap = {};
    VEHICLE_TYPES.forEach((t, i) => {
      colorMap[t] = VEHICLE_COLORS[i % VEHICLE_COLORS.length];
    });

    const cDatasets = [];
    const eDatasets = [];
    let cUnit = "units";
    let eUnit = "units";

    Object.entries(vehicleData).forEach(([key, data]) => {
      const vehicleType = key.replace(/_Consumption$|_Selected$/, "");
      const baseColor = colorMap[vehicleType] || "#000";
      const isActive = activeVehicle === vehicleType;
      const isDimmed = activeVehicle && !isActive;
      const color = isDimmed ? baseColor + "99" : baseColor;

      if (key.endsWith("_Consumption")) {
        if (!data.results?.length) return;
        const seen = new Set();
        const points = data.results
          .map((r) => ({ x: r.speed, y: r.consumption }))
          .filter((p) => {
            if (p.x < 0 || p.y == null) return false;
            if (seen.has(p.x)) return false;
            seen.add(p.x);
            return true;
          })
          .sort((a, b) => a.x - b.x);
        if (data.unit) cUnit = data.unit;
        cDatasets.push({
          label: vehicleType,
          data: points,
          borderColor: color,
          backgroundColor: "transparent",
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: isActive ? 4 : 0,
          borderWidth: isActive ? 3 : isDimmed ? 0.5 : 1,
          parsing: { xAxisKey: "x", yAxisKey: "y" },
          order: isActive ? 0 : 1,
          vehicleType,
          _baseColor: baseColor,
        });
      } else {
        let actual = data;
        if (data?.["0"] && !data.results) actual = data["0"];
        if (!actual?.results) return;
        const points = actual.results
          .map((r) => ({ x: r.speed, y: r.prediction }))
          .filter((p) => p.x >= 0 && p.y != null)
          .sort((a, b) => a.x - b.x);
        if (actual.unit) eUnit = actual.unit;
        eDatasets.push({
          label: vehicleType,
          data: points,
          borderColor: color,
          backgroundColor: "transparent",
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: isActive ? 4 : 0,
          borderWidth: isActive ? 3 : isDimmed ? 0.5 : 1,
          parsing: { xAxisKey: "x", yAxisKey: "y" },
          order: isActive ? 0 : 1,
          vehicleType,
          _baseColor: baseColor,
        });
      }
    });

    // Compute y-max for square grid calculation
    let cYMax = 0;
    cDatasets.forEach((ds) => ds.data.forEach((p) => { if (p.y > cYMax) cYMax = p.y; }));
    let eYMax = 0;
    eDatasets.forEach((ds) => ds.data.forEach((p) => { if (p.y > eYMax) eYMax = p.y; }));

    return {
      consumptionChartData: { datasets: cDatasets },
      emissionChartData: { datasets: eDatasets },
      consumptionUnit: cUnit,
      emissionUnit: eUnit,
      consumptionYMax: Math.ceil(cYMax) || 60,
      emissionYMax: Math.ceil(eYMax) || 60,
    };
  }, [vehicleData, activeVehicle]);

  // Dynamic axis labels
  const consumptionYAxisLabel = fuelType === "Electricity" ? "Energy Rate" : "Fuel Consumption Rate";
  const consumptionYAxisText = `${fuelType || consumptionYAxisLabel} (${consumptionUnit})`;
  const emissionYAxisText = `${emissionType || "Selected Emission Type"} (${emissionUnit})`;

  // Imperative chart hover — highlights hovered line, fades others (like R1/R2/R3)
  const handleChartHover = useCallback((_event, elements, chart) => {
    if (pinnedVehicleRef.current) return; // don't override pinned selection
    if (elements.length > 0) {
      const hoverIdx = elements[0].datasetIndex;
      chart.canvas.style.cursor = "pointer";
      chart.data.datasets.forEach((ds, i) => {
        const base = ds._baseColor;
        if (i === hoverIdx) {
          ds.borderColor = base;
          ds.borderWidth = 2.5;
        } else {
          ds.borderColor = base + "99"; // ~60% opacity
          ds.borderWidth = 1;
        }
      });
      chart.update("none");
    } else {
      chart.canvas.style.cursor = "default";
      chart.data.datasets.forEach((ds) => {
        const base = ds._baseColor;
        ds.borderColor = base + "B3"; // ~70% opacity
        ds.borderWidth = 1.5;
      });
      chart.update("none");
    }
  }, []);

  const handleChartClick = useCallback((_event, elements, chart) => {
    if (elements.length > 0) {
      const ds = chart.data.datasets[elements[0].datasetIndex];
      const vt = ds?.vehicleType;
      if (vt) setPinnedVehicle((prev) => (prev === vt ? null : vt));
    } else {
      setPinnedVehicle(null);
    }
  }, []);

  // Linear interpolation helper for continuous tooltip values
  const interpolateY = useCallback((data, x) => {
    if (!data || data.length < 2) return null;
    // Data is sorted by x (speed)
    for (let i = 0; i < data.length - 1; i++) {
      if (x >= data[i].x && x <= data[i + 1].x) {
        const x0 = data[i].x, y0 = data[i].y;
        const x1 = data[i + 1].x, y1 = data[i + 1].y;
        if (x1 === x0) return y0;
        const t = (x - x0) / (x1 - x0);
        return y0 + t * (y1 - y0);
      }
    }
    // Outside range: return nearest endpoint
    if (x < data[0].x) return data[0].y;
    return data[data.length - 1].y;
  }, []);

  // Chart options builder with dynamic y-axis step sizing (niceStepSize / square grid)
  const buildOptions = useCallback(
    (yAxisText, xMax, yMax, aspectOverride) => {
      const xRange = xMax || 70;
      const xStep = 10;
      const xCells = xRange / xStep;
      const aspectFactor = aspectOverride || 1.3;
      const effectiveYMax = yMax || 60;
      const targetCells = Math.round(xCells * aspectFactor);
      const rawYStep = effectiveYMax / targetCells;
      // Snap to a "nice" step that covers small decimals through thousands
      const niceSteps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
      const yStep = niceSteps.find((s) => s >= rawYStep) || rawYStep;

      return {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "nearest", intersect: false, axis: "xy" },
        onHover: handleChartHover,
        onClick: handleChartClick,
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true,
            backgroundColor: "#fff",
            titleColor: "#222",
            bodyColor: "#222",
            borderColor: "#ccc",
            borderWidth: 1,
            displayColors: true,
            callbacks: {
              title: (items) => items[0]?.dataset?.label || "",
              label: (item) => {
                if (!item?.chart) return "";
                const chart = item.chart;
                const xScale = chart.scales.x;
                const event = chart._lastEvent;
                if (event && xScale) {
                  const xValue = xScale.getValueForPixel(event.x);
                  const yValue = interpolateY(item.dataset.data, xValue);
                  return [
                    `Speed: ${xValue.toFixed(1)} mph`,
                    `Value: ${yValue?.toFixed(4) ?? "\u2014"}`,
                  ];
                }
                // Fallback to actual data point
                return [
                  `Speed: ${item.parsed?.x} mph`,
                  `Value: ${item.parsed?.y?.toFixed(4) ?? "\u2014"}`,
                ];
              },
              labelColor: (item) => {
                const idx = VEHICLE_TYPES.indexOf(item.dataset?.vehicleType);
                const c = idx >= 0 ? VEHICLE_COLORS[idx] : "#ccc";
                return { borderColor: c, backgroundColor: c };
              },
            },
          },
          zoom: {
            limits: { x: { min: 0 }, y: { min: 0 } },
            pan: { enabled: true, mode: "x" },
            zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" },
          },
        },
        parsing: { xAxisKey: "x", yAxisKey: "y" },
        scales: {
          x: {
            type: "linear",
            min: 0,
            ...(xMax != null ? { max: xMax } : {}),
            ticks: {
              stepSize: xStep,
              callback: (value) => (value % 10 === 0 ? value : ""),
              font: { size: 13 },
              color: "#222",
              autoSkip: false,
            },
            title: { display: true, text: "Speed (mph)", font: { size: 15 }, color: "#222" },
            grid: { color: "rgba(0,0,0,0.06)", lineWidth: 0.5 },
            border: { color: "#444" },
          },
          y: {
            type: "linear",
            position: "left",
            min: 0,
            title: { display: true, text: yAxisText, font: { size: 14 }, color: "#222" },
            ticks: {
              stepSize: yStep,
              font: { size: 12 },
              color: "#222",
              maxTicksLimit: 12,
            },
            grid: { color: "rgba(0,0,0,0.06)", lineWidth: 0.5 },
            border: { color: "#444" },
          },
          xTop: {
            position: "top",
            border: { display: true, color: "#444", width: 1 },
            grid: { drawOnChartArea: false, drawTicks: false },
            ticks: { display: false },
          },
          yRight: {
            position: "right",
            border: { display: true, color: "#444", width: 1 },
            grid: { drawOnChartArea: false, drawTicks: false },
            ticks: { display: false },
          },
        },
      };
    },
    [handleChartHover, handleChartClick, interpolateY]
  );

  const consumptionOptions = useMemo(() => buildOptions(consumptionYAxisText, undefined, consumptionYMax), [buildOptions, consumptionYAxisText, consumptionYMax]);
  const emissionOptions = useMemo(() => buildOptions(emissionYAxisText, undefined, emissionYMax, 1.0), [buildOptions, emissionYAxisText, emissionYMax]);

  const hasData = consumptionChartData.datasets.length > 0 || emissionChartData.datasets.length > 0;
  const allParamsSet = !!(fuelType && emissionType && vehicleAge);

  // Key for chart recreation — forces react-chartjs-2 to destroy/recreate when params change
  const chartKey = `${fuelType}|${emissionType}|${vehicleAge}|${city}`;

  const statesList = ["Atlanta", "Los Angeles", "Seattle", "NewYork"];

  return (
    <div className="flex flex-col gap-4 pt-4 px-6">
      {/* Parameter controls */}
      <div className="flex items-end gap-4 flex-wrap">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Fuel Type</label>
          <select
            value={fuelType}
            disabled={loading}
            onChange={(e) => setConsumptionAndEmissionState({ FuelType: e.target.value })}
            className={`border rounded px-2 py-1.5 text-sm w-56 ${loading ? "bg-gray-100 text-gray-400 cursor-not-allowed" : ""}`}
          >
            <option value="">Select Fuel Type</option>
            {FUEL_TYPES.map((ft) => (
              <option key={ft} value={ft}>{ft}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Emission Type</label>
          <select
            value={selectedEmissionTypeObj.value || ""}
            disabled={loading}
            onChange={(e) => setConsumptionAndEmissionState({ EmissionType: e.target.value })}
            className={`border rounded px-2 py-1.5 text-sm w-44 ${loading ? "bg-gray-100 text-gray-400 cursor-not-allowed" : ""}`}
          >
            <option value="">Select Emission Type</option>
            {availableEmissionTypes.map((et) => (
              <option key={et.value} value={et.value}>{et.label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Vehicle Age</label>
          <select
            value={vehicleAge}
            disabled={loading}
            onChange={(e) => setConsumptionAndEmissionState({ VehicleAge: e.target.value })}
            className={`border rounded px-2 py-1.5 text-sm w-28 ${loading ? "bg-gray-100 text-gray-400 cursor-not-allowed" : ""}`}
          >
            <option value="" disabled>Vehicle Age</option>
            {ageOptions.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">City</label>
          <select value={city} disabled className="bg-gray-100 text-gray-500 rounded px-2 py-1.5 text-sm w-32">
            <option value="">City</option>
            {statesList.map((st) => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>
        </div>

        {/* Loading progress bar */}
        {loading && totalCount > 0 && (
          <div className="flex items-center gap-2 ml-2 min-w-[180px]">
            <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${(loadedCount / totalCount) * 100}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 whitespace-nowrap">{loadedCount}/{totalCount}</span>
          </div>
        )}
      </div>

      {/* Charts + Legend */}
      {!allParamsSet && !hasData ? (
        <div className="flex items-center justify-center h-64 text-gray-400 text-sm border border-dashed border-gray-300 rounded-lg mt-2">
          Select fuel type, emission type, and vehicle age to generate charts
        </div>
      ) : (
        <div className="grid grid-cols-10 gap-4 mt-1 items-start">
          {/* Chart 1 — col-span-4 */}
          <div
            className="col-span-4 border border-gray-200 rounded-lg bg-white shadow-sm flex flex-col"
            onMouseLeave={() => setHoveredVehicle(null)}
          >
            <div className="flex items-center px-2 pt-2 pb-1 gap-2">
              <div className="flex-1" />
              <span className="text-sm font-semibold text-gray-600">
                {fuelType === "Electricity" ? "Energy Rate" : "Fuel Consumption Rate"}
              </span>
              <div className="flex-1 flex justify-end">
                <ZoomToolbar chartRef={consumptionChartRef} />
              </div>
            </div>
            <div className="px-2 pb-2" style={{ height: 280 }}>
              <Line key={`c-${chartKey}`} ref={consumptionChartRef} data={consumptionChartData} options={consumptionOptions} plugins={[chartBgPlugin, subGridThirdsXPlugin]} />
            </div>
          </div>

          {/* Chart 2 — col-span-4 */}
          <div
            className="col-span-4 border border-gray-200 rounded-lg bg-white shadow-sm flex flex-col"
            onMouseLeave={() => setHoveredVehicle(null)}
          >
            <div className="flex items-center px-2 pt-2 pb-1 gap-2">
              <div className="flex-1" />
              <span className="text-sm font-semibold text-gray-600">
                {emissionType || "Emission Type"}
              </span>
              <div className="flex-1 flex justify-end">
                <ZoomToolbar chartRef={emissionChartRef} />
              </div>
            </div>
            <div className="px-2 pb-2" style={{ height: 280 }}>
              <Line key={`e-${chartKey}`} ref={emissionChartRef} data={emissionChartData} options={emissionOptions} plugins={[chartBgPlugin, subGridThirdsXPlugin]} />
            </div>
          </div>

          {/* Interactive legend — col-span-2, click to pin-highlight, hover to preview */}
          <div
            className="col-span-2 flex flex-col gap-0.5 px-3 py-2 border border-gray-500 rounded-xl bg-white overflow-hidden min-w-0 shadow-md self-center"
          >
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-bold text-gray-800">Vehicle Types</span>
              {pinnedVehicle && (
                <button type="button" onClick={() => setPinnedVehicle(null)} className="text-[9px] text-blue-500 hover:text-blue-700 font-semibold">Clear</button>
              )}
            </div>
            {VEHICLE_TYPES.map((type, idx) => {
              const color = VEHICLE_COLORS[idx % VEHICLE_COLORS.length];
              const isPinned = pinnedVehicle === type;
              const isFaded = pinnedVehicle && !isPinned;
              return (
                <button
                  key={type}
                  type="button"
                  className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs cursor-pointer select-none min-w-0 w-full hover:opacity-80 transition-opacity"
                  style={{ opacity: isFaded ? 0.28 : 1 }}
                  onClick={() => setPinnedVehicle((prev) => (prev === type ? null : type))}
                >
                  <svg width="24" height="10" style={{ flexShrink: 0 }}>
                    <line x1="0" y1="5" x2="24" y2="5" stroke={color} strokeWidth={isPinned ? 2.5 : 1.5} strokeLinecap="round" />
                  </svg>
                  <span className={`truncate text-[11px] text-left ${isPinned ? "font-bold text-gray-900" : "font-bold text-gray-700"}`}>{type}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
