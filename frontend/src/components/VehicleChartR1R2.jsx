import React, { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import zoomPlugin from "chartjs-plugin-zoom";
import { CITY_TO_STATE, chartBgPlugin, CHART_FONT, subGridPlugin, subGridThirdsYPlugin } from "../utils/chartConstants";

import GA_R1 from "../assets/r1r2data/GA_R1.json";
import GA_R2 from "../assets/r1r2data/GA_R2.json";
import CA_R1 from "../assets/r1r2data/CA_R1.json";
import CA_R2 from "../assets/r1r2data/CA_R2.json";
import NY_R1 from "../assets/r1r2data/NY_R1.json";
import NY_R2 from "../assets/r1r2data/NY_R2.json";
import WA_R1 from "../assets/r1r2data/WA_R1.json";
import WA_R2 from "../assets/r1r2data/WA_R2.json";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, zoomPlugin);

const DATA_MAP = { GA_R1, GA_R2, CA_R1, CA_R2, NY_R1, NY_R2, WA_R1, WA_R2 };

export const TRACT_COLORS = [
  "#1f77b4","#aec7e8","#ff7f0e","#ffbb78","#2ca02c",
  "#98df8a","#d62728","#ff9896","#9467bd","#c5b0d5",
  "#8c564b","#c49c94","#e377c2","#f7b6d2","#7f7f7f",
  "#c7c7c7","#bcbd22","#dbdb8d","#17becf","#9edae5",
  "#393b79","#637939","#8c6d31","#843c39","#7b4173",
  "#5254a3","#8ca252","#bd9e39","#ad494a","#a55194",
];

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const ZoomToolbar = ({ chartRef }) => {
  const handleReset = () => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.resetZoom();
    // Force an immediate redraw so the axis visually snaps back
    chart.update("none");
  };
  return (
    <div className="absolute top-2 right-2 z-10 flex bg-white rounded border border-gray-300 shadow-sm overflow-hidden select-none">
      <button type="button" onClick={() => chartRef.current?.zoom(1.2)}
        className="px-2 py-0.5 text-blue-600 hover:bg-gray-50 border-r border-gray-200 text-sm font-bold leading-none">+</button>
      <button type="button" onClick={() => chartRef.current?.zoom(0.8)}
        className="px-2 py-0.5 text-blue-600 hover:bg-gray-50 border-r border-gray-200 text-sm font-bold leading-none">−</button>
      <button type="button" onClick={handleReset}
        className="px-2 py-0.5 text-[10px] font-semibold text-blue-600 hover:bg-gray-50 uppercase tracking-wide">Reset</button>
    </div>
  );
};

const FUEL_METRICS = new Set(["CNG", "Diesel", "Electricity", "Ethanol", "Gasoline"]);
const EMISSION_METRICS = new Set(["CO2", "NOx", "PM2.5B", "PM2.5T"]);

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

/** Pick a "nice" y-axis step so the chart gets ~5-8 evenly-spaced grid lines. */
function niceStepSize(maxVal) {
  if (!maxVal || maxVal <= 0) return undefined;
  const rough = maxVal / 6;
  const mag   = Math.pow(10, Math.floor(Math.log10(rough)));
  const residual = rough / mag;
  // Round up to the next "nice" number so we don't get too many ticks
  let nice;
  if (residual <= 1)        nice = 1;
  else if (residual <= 2)   nice = 2;
  else if (residual <= 5)   nice = 5;
  else                      nice = 10;
  return nice * mag;
}

// Manual step-size overrides where niceStepSize() produces sub-optimal y-axis intervals.
// Keyed by mode → metric. Metrics not listed here fall through to niceStepSize().
const STEP_OVERRIDES = {
  R1: { CNG: 0.2, Electricity: 0.01, Gasoline: 75, CO2: 0.75, "PM2.5T": 3 },
  R2: { Gasoline: 125, "PM2.5T": 6.25 },
};

const VehicleChartR1R2 = forwardRef(function VehicleChartR1R2({
  metric, cityName, mode,
  fuelFilter = null,          // when set + emission metric → use byFuel data
  selectedTractId = null,   // locked selection — from parent
  hoveredTractId = null,    // temporary hover — from parent (map swatches)
  onTractSelect = () => {}, // (tractId | null) => void
  controlledIdx = undefined,  // external index-based selection from legend
  onSelectIdx,                // (idx | null) => void
  overrideData = null,        // runtime-fetched data takes priority over static imports
}, ref) {
  const isControlled = controlledIdx !== undefined;
  const chartRef = useRef(null);
  useImperativeHandle(ref, () => ({ getChart: () => chartRef.current }), []);
  const [internalSelectedIdx, setInternalSelectedIdx] = useState(null);
  const internalSelectedIdxRef = useRef(null);

  // Ref so imperative callbacks always see the latest prop value
  const selectedTractIdRef = useRef(selectedTractId);
  useEffect(() => { selectedTractIdRef.current = selectedTractId; }, [selectedTractId]);

  const controlledIdxRef = useRef(controlledIdx);
  useEffect(() => { controlledIdxRef.current = controlledIdx; }, [controlledIdx]);

  const state    = CITY_TO_STATE[cityName] || CITY_TO_STATE[cityName?.replace(/\s/g, "")] || null;
  const fileKey  = state && mode ? `${state}_${mode}` : null;
  const fileData = overrideData || (fileKey ? DATA_MAP[fileKey] : null);

  // When fuelFilter is set and metric is an emission type, use per-fuel data
  const useFuelBreakdown = fuelFilter && EMISSION_METRICS.has(metric);
  const metricData = useFuelBreakdown
    ? fileData?.byFuel?.[fuelFilter]?.[metric]
    : (fileData && metric ? fileData[metric] : null);

  if (!metricData) {
    const msg = useFuelBreakdown
      ? `No fuel-specific ${metric} data available for ${fuelFilter}.`
      : (!cityName || !metric ? "Select a city and metric." : `No data for ${metric} — ${cityName}.`);
    return (
      <div className="flex items-center justify-center h-40 text-gray-400 text-sm border border-gray-200 rounded-lg bg-gray-50">
        {msg}
      </div>
    );
  }

  const { labels: rawLabels, unit, tracts: rawTracts } = metricData;

  const MONTH_ABBRS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  // Convert 24-hour labels to 12-hour format for R1 (Daily)
  // Data is 0:00–24:00 (25 points, 12 AM to 12 AM)
  let labels, tracts, tooltipLabels;
  if (mode === "R1") {
    labels = rawLabels.map((lbl) => {
      const h = parseInt(lbl, 10);
      if (isNaN(h)) return lbl;
      if (h === 0 || h === 24) return "12 AM";
      if (h === 12) return "12 PM";
      return h < 12 ? `${h} AM` : `${h - 12} PM`;
    });
    tracts = rawTracts;
    tooltipLabels = labels;
  } else {
    // R2: expand 7 annual values into 84 monthly values
    const years = rawLabels; // e.g. ["2024","2025",...,"2030"]
    labels = [];
    tooltipLabels = [];
    years.forEach((yr) => {
      MONTH_ABBRS.forEach((m) => {
        labels.push(m);
        tooltipLabels.push(`${m} ${yr}`);
      });
    });
    // Divide each annual value by 12 and repeat for 12 months
    tracts = {};
    for (const [id, annualVals] of Object.entries(rawTracts)) {
      const monthly = [];
      annualVals.forEach((val) => {
        const mVal = val / 12;
        for (let i = 0; i < 12; i++) monthly.push(mVal);
      });
      tracts[id] = monthly;
    }
  }
  const tractIds = Object.keys(tracts);

  // Resolve which tract index is "active" (controlled > internal > external locked > hovered)
  const extActiveTractId = selectedTractId || hoveredTractId;
  const extActiveIdx     = extActiveTractId ? tractIds.indexOf(extActiveTractId) : -1;
  const activeIdx        = isControlled ? (controlledIdx !== null ? controlledIdx : -1)
                         : internalSelectedIdx !== null ? internalSelectedIdx : extActiveIdx;
  const isLocked         = isControlled ? controlledIdx !== null : internalSelectedIdx !== null || selectedTractId !== null;

  // ── Imperative helpers (chart-line hover only) ────────────────────────────

  const applyChartHover = (chart, hoverIdx) => {
    if (isControlled ? controlledIdxRef.current !== null : internalSelectedIdxRef.current !== null) return;
    chart.data.datasets.forEach((ds, i) => {
      const base = ds._baseColor;
      if (i === hoverIdx) {
        ds.borderColor = base;
        ds.borderWidth = 2.5;
      } else {
        ds.borderColor = hexToRgba(base, 0.1);
        ds.borderWidth = 1;
      }
      ds.pointRadius = 0;
    });
    chart.update("none");
  };

  const clearChartHover = (chart) => {
    const sel = isControlled ? controlledIdxRef.current : internalSelectedIdxRef.current;
    chart.data.datasets.forEach((ds, i) => {
      const base = ds._baseColor;
      if (sel !== null) {
        if (i === sel) {
          ds.borderColor = base;
          ds.borderWidth = 3;
        } else {
          ds.borderColor = hexToRgba(base, 0.6);
          ds.borderWidth = 1;
        }
      } else {
        ds.borderColor = hexToRgba(base, 0.7);
        ds.borderWidth = 1.5;
      }
      ds.pointRadius = 0;
    });
    chart.update("none");
  };

  // ── Dataset styles (React render path) ────────────────────────────────────

  const tractDatasets = tractIds.map((tractId, idx) => {
    const color = TRACT_COLORS[idx % TRACT_COLORS.length];
    let borderColor, borderWidth;

    if (activeIdx >= 0) {
      if (idx === activeIdx) {
        borderColor = color;
        borderWidth = isLocked ? 3 : 2.5;
      } else {
        borderColor = hexToRgba(color, 0.6);
        borderWidth = 1;
      }
    } else {
      borderColor = hexToRgba(color, 0.7);
      borderWidth = 1.5;
    }

    return {
      label: `Tract ${tractId}`,
      data: tracts[tractId],
      borderColor, backgroundColor: "rgba(0,0,0,0)", borderWidth,
      pointRadius: 0,
      tension: 0.4,
      _baseColor: color,
    };
  });

  const datasets = [...tractDatasets];
  const xLabel = mode === "R1" ? "Hour of Day" : "Month";

  // Compute y-axis step size — always use dynamic nice steps from data
  let dataMax = 0;
  tractIds.forEach(id => tracts[id].forEach(v => { if (v > dataMax) dataMax = v; }));
  const yStepSize = niceStepSize(dataMax);

  const options = {
    responsive: true, maintainAspectRatio: false, animation: false,
    layout: { padding: { top: 22, right: 24, bottom: mode === "R2" ? 75 : 0, left: 0 } },
    hover: { mode: "nearest", intersect: false },

    onHover: (_evt, activeElements, chart) => {
      const overTract = activeElements.length > 0;
      chart.canvas.style.cursor = overTract ? "pointer" : "default";
      if (internalSelectedIdxRef.current !== null) return;
      if (overTract) applyChartHover(chart, activeElements[0].datasetIndex);
      else clearChartHover(chart);
    },

    onClick: (_evt, activeElements) => {
      if (activeElements.length > 0) {
        const dsIdx = activeElements[0].datasetIndex;
        const ds = datasets[dsIdx];
        if (isControlled) {
          onSelectIdx?.(controlledIdx === dsIdx ? null : dsIdx);
        } else {
          const newIdx = internalSelectedIdxRef.current === dsIdx ? null : dsIdx;
          internalSelectedIdxRef.current = newIdx;
          setInternalSelectedIdx(newIdx);
          const tractId = tractIds[dsIdx];
          onTractSelect(selectedTractIdRef.current === tractId ? null : tractId);
        }
      } else {
        if (isControlled) {
          onSelectIdx?.(null);
        } else {
          internalSelectedIdxRef.current = null;
          setInternalSelectedIdx(null);
          onTractSelect(null);
        }
      }
    },

    plugins: {
      yearLabels: {
        enabled: mode === "R2",
        years: mode === "R2" ? rawLabels : [],
      },
      legend: { display: false },
      tooltip: {
        mode: "nearest", intersect: false,
        backgroundColor: "#fff", titleColor: "#222", bodyColor: "#222",
        borderColor: "#ccc", borderWidth: 1, displayColors: true,
        callbacks: {
          title: (items) => {
            const idx = items[0]?.dataIndex;
            return idx != null && tooltipLabels[idx] ? tooltipLabels[idx] : (items[0]?.label || "");
          },
          label: (item) => {
            const idx = item.datasetIndex;
            const vehicleName = VEHICLE_TYPES[idx % VEHICLE_TYPES.length];
            const match = unit.match(/^(.+?)\s*\((.+)\)$/);
            const name = match ? match[1] : unit;
            const uom = match ? match[2] : "";
            return ` ${vehicleName}: ${item.parsed.y?.toFixed(4)}${uom ? ` (${uom})` : ""}`;
          },
          labelColor: (item) => ({ borderColor: item.dataset._baseColor || "#1a1a1a", backgroundColor: item.dataset._baseColor || "#1a1a1a" }),
          labelTextColor: () => "#222",
        },
      },
      zoom: {
        pan: { enabled: true, mode: "x" },
        zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: "x" },
      },
    },
    scales: {
      x: {
        border: { display: true, color: "#444", width: 1 },
        grid: { display: true, color: "rgba(169,169,169,0.15)", lineWidth: 0.8, drawTicks: true, tickColor: "#444" },
        ticks: {
          autoSkip: false,
          maxRotation: mode === "R2" ? 90 : 90,
          minRotation: mode === "R2" ? 90 : 90,
          font: mode === "R2" ? { ...CHART_FONT, size: 11 } : CHART_FONT,
          color: "#222",
          padding: mode === "R1" ? 2 : 6,
          ...(mode === "R2" ? {
            callback: function(_value, index) {
              // Show label every 3 months (Jan, Apr, Jul, Oct)
              if (index % 3 === 0) return labels[index] || "";
              return "";
            },
          } : { maxTicksLimit: 25 }),
        },
        title: { display: mode !== "R2", text: xLabel, font: CHART_FONT, color: "#222", padding: { top: 8, bottom: 0 } },
      },
      xTop: {
        position: "top",
        border: { display: true, color: "#444", width: 1 },
        grid: { drawOnChartArea: false, drawTicks: false },
        ticks: { display: false },
      },
      y: {
        border: { display: true, color: "#444", width: 1 },
        grid: { display: true, color: "rgba(169,169,169,0.15)", lineWidth: 0.8, drawTicks: false },
        ticks: {
          font: CHART_FONT, color: "#222", padding: 4,
          ...(yStepSize ? { stepSize: yStepSize } : { maxTicksLimit: 8 }),
        },
        title: { display: true, text: unit, font: CHART_FONT, color: "#222", padding: { top: 0, bottom: 0 } },
      },
      yRight: {
        position: "right",
        border: { display: true, color: "#444", width: 1 },
        grid: { drawOnChartArea: false, drawTicks: false },
        ticks: { display: false },
      },
    },
  };

  // Canvas plugin to draw year labels below month ticks on R2 charts.
  // IMPORTANT: read data from chart.options (which react-chartjs-2 updates),
  // NOT from the component closure (which is frozen at mount time).
  const yearLabelsPlugin = {
    id: "yearLabels",
    afterDraw(chart) {
      const cfg = chart.options?.plugins?.yearLabels;
      if (!cfg?.enabled) return;
      const years = cfg.years;
      if (!years || years.length === 0) return;
      const xScale = chart.scales?.x;
      if (!xScale) return;
      const ctx = chart.ctx;
      ctx.save();
      ctx.font = "12px sans-serif";
      ctx.fillStyle = "#444";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      // Draw year labels centered below each year's 12-month span
      const yPos = chart.chartArea.bottom + 60;
      for (let yearIdx = 0; yearIdx < years.length; yearIdx++) {
        const startIdx = yearIdx * 12;
        const endIdx = Math.min(startIdx + 11, chart.data.labels.length - 1);
        const x1 = xScale.getPixelForValue(startIdx);
        const x2 = xScale.getPixelForValue(endIdx);
        if (isNaN(x1) || isNaN(x2)) continue;
        const centerX = (x1 + x2) / 2;
        ctx.fillText(years[yearIdx], centerX, yPos);
      }
      ctx.restore();
    },
  };

  return (
    <div className="w-full h-full flex flex-col">
      {/* Chart — fills all remaining height */}
      <div className="relative w-full flex-1 min-h-0 bg-white">
        <Line ref={chartRef} data={{ labels, datasets }} options={options} plugins={[chartBgPlugin, mode === "R2" ? subGridThirdsYPlugin : subGridPlugin, yearLabelsPlugin]} />
        <ZoomToolbar chartRef={chartRef} />
      </div>
    </div>
  );
});

export default VehicleChartR1R2;
