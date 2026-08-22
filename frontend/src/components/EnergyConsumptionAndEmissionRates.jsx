import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import useAppStore from "../useAppStore";
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

// Emission types used for generation (excludes Energy Rate which is consumption-only)
const GENERATION_EMISSION_TYPES = EMISSION_TYPES.filter((et) => et.value !== "Energy Rate");

// For Electricity fuel type, CO2 and NOx are excluded
const ELECTRICITY_EXCLUDED = new Set(["CO2 Emissions", "NOx"]);

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

// Map city names to state codes used in the pregenerated JSON filenames
const CITY_TO_STATE = {
  Atlanta: "GA",
  "Los Angeles": "CA",
  LosAngeles: "CA",
  NewYork: "NY",
  Seattle: "WA",
};

// Inline zoom toolbar — sits in the chart header row, no absolute positioning
const ZoomToolbar = ({ chartRef }) => (
  <div className="flex bg-white rounded border border-gray-300 shadow-sm overflow-hidden select-none shrink-0">
    <button onClick={() => chartRef.current?.zoom(1.1)} className="px-2.5 py-1 text-blue-600 hover:bg-gray-50 border-r border-gray-200 text-base font-bold leading-none transition-colors" title="Zoom In" type="button">+</button>
    <button onClick={() => chartRef.current?.zoom(0.9)} className="px-2.5 py-1 text-blue-600 hover:bg-gray-50 border-r border-gray-200 text-base font-bold leading-none transition-colors" title="Zoom Out" type="button">-</button>
    <button onClick={() => chartRef.current?.resetZoom()} className="px-2.5 py-1 text-[10px] font-semibold text-blue-600 hover:bg-gray-50 uppercase tracking-wide transition-colors" title="Reset Zoom" type="button">Reset</button>
  </div>
);

export default function EnergyConsumptionAndEmissionRates() {
  const consumptionChartRef = useRef(null);
  const emissionChartRef = useRef(null);

  // Store slices
  const classificationState = useAppStore((s) => s.classificationState);
  const ConsumptionAndEmissionState = useAppStore((s) => s.ConsumptionAndEmission);
  const setConsumptionAndEmissionState = useAppStore((s) => s.setConsumptionAndEmission);

  // Interactive legend state
  const [hoveredVehicle, setHoveredVehicle] = useState(null);
  const [pinnedVehicle, setPinnedVehicle] = useState(null);
  const pinnedVehicleRef = useRef(null);
  useEffect(() => {
    pinnedVehicleRef.current = pinnedVehicle;
  }, [pinnedVehicle]);
  const activeVehicle = hoveredVehicle || pinnedVehicle;

  // Pre-generated data cache: { [stateCode]: jsonData }
  const [pregenData, setPregenData] = useState({});
  const [loadingPregen, setLoadingPregen] = useState(false);
  const [pregenError, setPregenError] = useState(null);

  // Derived params
  const fuelType = ConsumptionAndEmissionState.FuelType || "";
  const emissionType = ConsumptionAndEmissionState.EmissionType || "";
  const vehicleAge = ConsumptionAndEmissionState.VehicleAge ?? "";
  const rawCity = classificationState.city || classificationState.cityInput;
  const city = CITY_NAME_MAP[rawCity] || rawCity;
  const stateCode = CITY_TO_STATE[city] || "GA";
  const selectedEmissionTypeObj = EMISSION_TYPES.find((et) => et.value === emissionType || et.label === emissionType) || {};

  const ageOptions = useMemo(() => Array.from({ length: 41 }, (_, i) => i), []);

  // Filter emission types based on selected fuel type (Electricity hides CO2 and NOx)
  const availableEmissionTypes = useMemo(() => {
    const forbidden = fuelType === "Electricity" ? ELECTRICITY_EXCLUDED : new Set();
    return EMISSION_TYPES.filter((et) => et.value !== "Energy Rate" && !forbidden.has(et.backend));
  }, [fuelType]);

  // Auto-correct emission type when switching to Electricity fuel
  useEffect(() => {
    if (fuelType === "Electricity" && selectedEmissionTypeObj.backend && ELECTRICITY_EXCLUDED.has(selectedEmissionTypeObj.backend)) {
      const firstAvailable = availableEmissionTypes[0];
      if (firstAvailable) {
        setConsumptionAndEmissionState({ EmissionType: firstAvailable.value });
      }
    }
  }, [fuelType, selectedEmissionTypeObj.backend, availableEmissionTypes, setConsumptionAndEmissionState]);

  // Load pre-generated JSON when state changes
  useEffect(() => {
    if (!stateCode || pregenData[stateCode]) return;

    setLoadingPregen(true);
    setPregenError(null);

    fetch(`${import.meta.env.BASE_URL}pregenerated/${stateCode}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load pregenerated data for ${stateCode}`);
        return res.json();
      })
      .then((data) => {
        setPregenData((prev) => ({ ...prev, [stateCode]: data }));
        setLoadingPregen(false);

        // Set defaults if not already set
        if (!fuelType) {
          setConsumptionAndEmissionState({ FuelType: FUEL_TYPES[0] });
        }
        if (!emissionType) {
          setConsumptionAndEmissionState({ EmissionType: GENERATION_EMISSION_TYPES[0].value });
        }
      })
      .catch((err) => {
        console.error("Failed to load pregenerated data:", err);
        setPregenError(err.message);
        setLoadingPregen(false);
      });
  }, [stateCode]); // eslint-disable-line react-hooks/exhaustive-deps

  // The current state's data
  const stateData = pregenData[stateCode] || null;
  const dataReady = !!stateData && vehicleAge !== "";

  // Build chart datasets from pre-generated data
  const { consumptionChartData, emissionChartData, consumptionUnit, emissionUnit, consumptionYMax, emissionYMax } = useMemo(() => {
    const colorMap = {};
    VEHICLE_TYPES.forEach((t, i) => {
      colorMap[t] = VEHICLE_COLORS[i % VEHICLE_COLORS.length];
    });

    const cDatasets = [];
    const eDatasets = [];
    let cUnit = "units";
    let eUnit = "units";

    if (dataReady && fuelType) {
      const ageStr = String(vehicleAge);

      // Consumption: lookup from pregenerated data
      VEHICLE_TYPES.forEach((vt) => {
        const consKey = `${fuelType}|${vt}`;
        const consEntry = stateData.consumption?.[consKey];
        if (!consEntry?.ages?.[ageStr]) return;

        const speedValues = consEntry.ages[ageStr];
        const baseColor = colorMap[vt] || "#000";
        const isActive = activeVehicle === vt;
        const isDimmed = activeVehicle && !isActive;
        const color = isDimmed ? baseColor + "99" : baseColor;

        const points = speedValues
          .map((v, speed) => ({ x: speed, y: v }))
          .filter((p) => p.y != null);

        if (consEntry.unit) cUnit = consEntry.unit;
        cDatasets.push({
          label: vt,
          data: points,
          borderColor: color,
          backgroundColor: "transparent",
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: isActive ? 4 : 0,
          borderWidth: isActive ? 3 : isDimmed ? 0.5 : 1,
          parsing: { xAxisKey: "x", yAxisKey: "y" },
          order: isActive ? 0 : 1,
          vehicleType: vt,
          _baseColor: baseColor,
        });
      });

      // Emissions: lookup from pregenerated data
      if (emissionType && selectedEmissionTypeObj.backend) {
        const emBackend = selectedEmissionTypeObj.backend;
        VEHICLE_TYPES.forEach((vt) => {
          // Skip electricity-excluded combinations
          if (fuelType === "Electricity" && ELECTRICITY_EXCLUDED.has(emBackend)) return;

          const emKey = `${fuelType}|${emBackend}|${vt}`;
          const emEntry = stateData.emissions?.[emKey];
          if (!emEntry?.ages?.[ageStr]) return;

          const speedValues = emEntry.ages[ageStr];
          const baseColor = colorMap[vt] || "#000";
          const isActive = activeVehicle === vt;
          const isDimmed = activeVehicle && !isActive;
          const color = isDimmed ? baseColor + "99" : baseColor;

          const points = speedValues
            .map((v, speed) => ({ x: speed, y: v }))
            .filter((p) => p.y != null);

          if (emEntry.unit) eUnit = emEntry.unit;
          eDatasets.push({
            label: vt,
            data: points,
            borderColor: color,
            backgroundColor: "transparent",
            tension: 0.3,
            pointRadius: 0,
            pointHoverRadius: isActive ? 4 : 0,
            borderWidth: isActive ? 3 : isDimmed ? 0.5 : 1,
            parsing: { xAxisKey: "x", yAxisKey: "y" },
            order: isActive ? 0 : 1,
            vehicleType: vt,
            _baseColor: baseColor,
          });
        });
      }
    }

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
  }, [stateData, activeVehicle, fuelType, emissionType, vehicleAge, dataReady, selectedEmissionTypeObj.backend]);

  // Dynamic axis labels
  const consumptionYAxisLabel = fuelType === "Electricity" ? "Energy Rate" : "Fuel Consumption Rate";
  const consumptionYAxisText = `${fuelType || consumptionYAxisLabel} (${consumptionUnit})`;
  const emissionYAxisText = `${emissionType || "Selected Emission Type"} (${emissionUnit})`;

  // Imperative chart hover — highlights hovered line, fades others
  const handleChartHover = useCallback((_event, elements, chart) => {
    if (pinnedVehicleRef.current) return;
    if (elements.length > 0) {
      const hoverIdx = elements[0].datasetIndex;
      chart.canvas.style.cursor = "pointer";
      chart.data.datasets.forEach((ds, i) => {
        const base = ds._baseColor;
        if (i === hoverIdx) {
          ds.borderColor = base;
          ds.borderWidth = 2.5;
        } else {
          ds.borderColor = base + "99";
          ds.borderWidth = 1;
        }
      });
      chart.update("none");
    } else {
      chart.canvas.style.cursor = "default";
      chart.data.datasets.forEach((ds) => {
        const base = ds._baseColor;
        ds.borderColor = base + "B3";
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
    for (let i = 0; i < data.length - 1; i++) {
      if (x >= data[i].x && x <= data[i + 1].x) {
        const x0 = data[i].x, y0 = data[i].y;
        const x1 = data[i + 1].x, y1 = data[i + 1].y;
        if (x1 === x0) return y0;
        const t = (x - x0) / (x1 - x0);
        return y0 + t * (y1 - y0);
      }
    }
    if (x < data[0].x) return data[0].y;
    return data[data.length - 1].y;
  }, []);

  // Chart options builder
  const buildOptions = useCallback(
    (yAxisText, xMax, yMax, aspectOverride) => {
      const xRange = xMax || 70;
      const xStep = 10;
      const xCells = xRange / xStep;
      const aspectFactor = aspectOverride || 1.3;
      const effectiveYMax = yMax || 60;
      const targetCells = Math.round(xCells * aspectFactor);
      const rawYStep = effectiveYMax / targetCells;
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

  // Chart key for recreation
  const chartKey = `${fuelType}|${emissionType}|${vehicleAge}|${stateCode}`;

  const statesList = ["Atlanta", "Los Angeles", "Seattle", "NewYork"];

  return (
    <div className="flex flex-col gap-4 pt-4 px-6">
      {/* Page title */}
      <div className="mb-1">
        <h1 className="text-2xl font-bold text-gray-800">Vehicle Energy Consumption and Emission Rates</h1>
        <p className="text-sm text-gray-500 mt-1">Explore consumption and emission predictions across all vehicle types. Select parameters below to view charts instantly.</p>
      </div>

      {/* Parameter controls */}
      <div className="flex items-end gap-4 flex-wrap">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Vehicle Age</label>
          <select
            value={vehicleAge}
            onChange={(e) => setConsumptionAndEmissionState({ VehicleAge: e.target.value })}
            disabled={loadingPregen}
            className={`border rounded px-2 py-1.5 text-sm w-28 ${loadingPregen ? "bg-gray-100 text-gray-500" : ""}`}
          >
            <option value="">Vehicle Age</option>
            {ageOptions.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-600">Fuel Type</label>
          <select
            value={fuelType}
            onChange={(e) => setConsumptionAndEmissionState({ FuelType: e.target.value })}
            disabled={loadingPregen}
            className={`border rounded px-2 py-1.5 text-sm w-56 ${loadingPregen ? "bg-gray-100 text-gray-500" : ""}`}
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
            onChange={(e) => setConsumptionAndEmissionState({ EmissionType: e.target.value })}
            disabled={loadingPregen}
            className={`border rounded px-2 py-1.5 text-sm w-44 ${loadingPregen ? "bg-gray-100 text-gray-500" : ""}`}
          >
            <option value="">Select Emission Type</option>
            {availableEmissionTypes.map((et) => (
              <option key={et.value} value={et.value}>{et.label}</option>
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

        {/* Loading indicator for initial JSON fetch */}
        {loadingPregen && (
          <span className="text-xs text-blue-500 font-medium self-center">Loading data...</span>
        )}
        {pregenError && (
          <span className="text-xs text-red-500 font-medium self-center">Error: {pregenError}</span>
        )}
      </div>

      {/* Charts + Legend */}
      {!hasData ? (
        <div className="flex items-center justify-center h-64 text-gray-400 text-sm border border-dashed border-gray-300 rounded-lg mt-2">
          {loadingPregen
            ? "Loading pre-generated prediction data..."
            : "Select vehicle age, fuel type, and emission type to view predictions instantly"}
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

          {/* Interactive legend — col-span-2 */}
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
