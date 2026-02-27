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

// Zoom toolbar (takes chartRef directly)
const ZoomToolbar = ({ chartRef }) => (
  <div className="absolute top-2 right-2 z-10 flex bg-white rounded border border-gray-300 shadow-sm overflow-hidden select-none">
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
  const activeVehicle = hoveredVehicle || pinnedVehicle;

  // Loading progress
  const [loading, setLoading] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  // Track last-fetched params to skip redundant requests
  const lastFetchRef = useRef({ fuelType: null, emissionType: null, vehicleAge: null, city: null });
  const abortRef = useRef(null);

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

    if (!fuelChanged && !emissionChanged && !ageChanged && !cityChanged) return;

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
  const { consumptionChartData, emissionChartData, consumptionUnit, emissionUnit } = useMemo(() => {
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
      const color = isDimmed ? baseColor + "30" : baseColor;

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
        });
      }
    });

    return {
      consumptionChartData: { datasets: cDatasets },
      emissionChartData: { datasets: eDatasets },
      consumptionUnit: cUnit,
      emissionUnit: eUnit,
    };
  }, [vehicleData, activeVehicle]);

  // Dynamic axis labels
  const consumptionYAxisLabel = fuelType === "Electricity" ? "Energy Rate" : "Fuel Consumption Rate";
  const consumptionYAxisText = `${fuelType || consumptionYAxisLabel} (${consumptionUnit})`;
  const emissionYAxisText = `${emissionType || "Selected Emission Type"} (${emissionUnit})`;

  // Chart hover handler — syncs both charts via shared activeVehicle
  const handleChartHover = useCallback((_event, elements, chart) => {
    if (elements.length > 0) {
      const ds = chart.data.datasets[elements[0].datasetIndex];
      setHoveredVehicle(ds?.vehicleType || null);
    } else {
      setHoveredVehicle(null);
    }
  }, []);

  // Chart options builder
  const buildOptions = useCallback(
    (yAxisText, xMax) => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "nearest", intersect: false, axis: "xy" },
      onHover: handleChartHover,
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
              if (!item?.parsed) return "";
              return [
                `Speed: ${item.parsed.x} mph`,
                `Value: ${item.parsed.y?.toFixed(4) ?? "\u2014"}`,
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
          ticks: { stepSize: 10, font: { size: 11 } },
          title: { display: true, text: "Speed (mph)", font: { size: 13 } },
          grid: { color: "rgba(0,0,0,0.06)" },
        },
        y: {
          type: "linear",
          position: "left",
          min: 0,
          title: { display: true, text: yAxisText, font: { size: 13 } },
          ticks: { font: { size: 11 } },
          grid: { color: "rgba(0,0,0,0.06)" },
        },
      },
    }),
    [handleChartHover]
  );

  const consumptionOptions = useMemo(() => buildOptions(consumptionYAxisText), [buildOptions, consumptionYAxisText]);
  const emissionOptions = useMemo(() => buildOptions(emissionYAxisText, 70), [buildOptions, emissionYAxisText]);

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

        {/* Loading progress */}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-blue-600 ml-2">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <span>Loading {loadedCount}/{totalCount}...</span>
          </div>
        )}
      </div>

      {/* Charts + Legend */}
      {!allParamsSet && !hasData ? (
        <div className="flex items-center justify-center h-64 text-gray-400 text-sm border border-dashed border-gray-300 rounded-lg mt-2">
          Select fuel type, emission type, and vehicle age to generate charts
        </div>
      ) : (
        <>
          {/* Two charts side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-1">
            <div
              className="relative border border-gray-200 rounded-lg bg-white shadow-sm"
              style={{ height: 380 }}
              onMouseLeave={() => setHoveredVehicle(null)}
            >
              <div className="text-center text-sm font-semibold text-gray-600 pt-2 pb-1">
                {fuelType === "Electricity" ? "Energy Rate" : "Fuel Consumption Rate"}
              </div>
              <div style={{ height: "calc(100% - 32px)", padding: "0 8px 8px" }}>
                <Line key={`c-${chartKey}`} ref={consumptionChartRef} data={consumptionChartData} options={consumptionOptions} />
              </div>
              <ZoomToolbar chartRef={consumptionChartRef} />
            </div>

            <div
              className="relative border border-gray-200 rounded-lg bg-white shadow-sm"
              style={{ height: 380 }}
              onMouseLeave={() => setHoveredVehicle(null)}
            >
              <div className="text-center text-sm font-semibold text-gray-600 pt-2 pb-1">
                {emissionType || "Emission Type"}
              </div>
              <div style={{ height: "calc(100% - 32px)", padding: "0 8px 8px" }}>
                <Line key={`e-${chartKey}`} ref={emissionChartRef} data={emissionChartData} options={emissionOptions} />
              </div>
              <ZoomToolbar chartRef={emissionChartRef} />
            </div>
          </div>

          {/* Interactive legend — click to pin-highlight, hover to preview */}
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 border border-gray-200 rounded-lg bg-white"
            onMouseLeave={() => setHoveredVehicle(null)}
          >
            <span className="text-xs font-semibold text-gray-500 mr-1">Vehicle Types</span>
            {VEHICLE_TYPES.map((type, idx) => {
              const color = VEHICLE_COLORS[idx % VEHICLE_COLORS.length];
              const isPinned = pinnedVehicle === type;
              const isDimmed = activeVehicle && activeVehicle !== type;
              return (
                <button
                  key={type}
                  type="button"
                  className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs transition-all cursor-pointer select-none
                    ${isPinned ? "bg-blue-50 ring-1 ring-blue-300" : "hover:bg-gray-50"}
                    ${isDimmed ? "opacity-30" : "opacity-100"}`}
                  onMouseEnter={() => setHoveredVehicle(type)}
                  onClick={() => setPinnedVehicle((prev) => (prev === type ? null : type))}
                >
                  <span className="inline-block w-4 h-0.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="font-medium text-gray-700 whitespace-nowrap">{type}</span>
                </button>
              );
            })}
            {pinnedVehicle && (
              <button
                type="button"
                onClick={() => setPinnedVehicle(null)}
                className="text-xs text-blue-500 hover:text-blue-700 font-medium ml-auto"
              >
                Clear
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
