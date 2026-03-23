import React, { useEffect, useRef, useState } from "react";
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

const CITY_TO_STATE = {
  Atlanta: "GA", "Los Angeles": "CA", LosAngeles: "CA", NewYork: "NY", Seattle: "WA",
};

const TRACT_COLORS = [
  "#1f77b4","#aec7e8","#ff7f0e","#ffbb78","#2ca02c",
  "#98df8a","#d62728","#ff9896","#9467bd","#c5b0d5",
  "#8c564b","#c49c94","#e377c2","#f7b6d2","#7f7f7f",
  "#c7c7c7","#bcbd22","#dbdb8d","#17becf","#9edae5",
  "#393b79","#637939","#8c6d31","#843c39","#7b4173",
  "#5254a3","#8ca252","#bd9e39","#ad494a","#a55194",
];

const FUEL_METRICS = new Set(["CNG", "Diesel", "Electricity", "Ethanol", "Gasoline"]);

/** Pick a "nice" y-axis step so the chart gets ~5-8 evenly-spaced grid lines. */
function niceStepSize(maxVal) {
  if (!maxVal || maxVal <= 0) return undefined;
  const rough = maxVal / 6;
  const mag   = Math.pow(10, Math.floor(Math.log10(rough)));
  const residual = rough / mag;
  let nice;
  if (residual <= 1)        nice = 1;
  else if (residual <= 2)   nice = 2;
  else if (residual <= 5)   nice = 5;
  else                      nice = 10;
  return nice * mag;
}

// Fixed step sizes per mode; others use dynamic calculation
const STEP_OVERRIDES = {
  R1: { CNG: 0.2, Electricity: 0.01, Gasoline: 75, CO2: 0.75, "PM2.5T": 3 },
  R2: { Gasoline: 1500, "PM2.5T": 75 },
};

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const chartBgPlugin = {
  id: "chartBg",
  beforeDraw(chart) {
    const { ctx, chartArea } = chart;
    if (!chartArea) return;
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(chartArea.left, chartArea.top, chartArea.width, chartArea.height);
    ctx.restore();
  },
};

const ZoomToolbar = ({ chartRef }) => (
  <div className="absolute bottom-2 right-2 z-10 flex bg-white rounded border border-gray-300 shadow-sm overflow-hidden select-none">
    <button type="button" onClick={() => chartRef.current?.zoom(1.2)}
      className="px-2 py-0.5 text-blue-600 hover:bg-gray-50 border-r border-gray-200 text-sm font-bold leading-none" title="Zoom In">+</button>
    <button type="button" onClick={() => chartRef.current?.zoom(0.8)}
      className="px-2 py-0.5 text-blue-600 hover:bg-gray-50 border-r border-gray-200 text-sm font-bold leading-none" title="Zoom Out">−</button>
    <button type="button" onClick={() => chartRef.current?.resetZoom()}
      className="px-2 py-0.5 text-[10px] font-semibold text-blue-600 hover:bg-gray-50 uppercase tracking-wide" title="Reset Zoom">Reset</button>
  </div>
);

export default function VehicleChartR1R2({ metric, cityName, mode }) {
  const chartRef = useRef(null);
  const containerRef = useRef(null);
  // selectedIdx drives React render (persistent state)
  const [selectedIdx, setSelectedIdx] = useState(null);
  // ref mirrors state to avoid stale closures inside Chart.js callbacks
  const selectedIdxRef = useRef(null);

  // Clear selection when clicking outside the chart card
  useEffect(() => {
    const onClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        if (selectedIdxRef.current !== null) {
          selectedIdxRef.current = null;
          setSelectedIdx(null);
        }
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const state = CITY_TO_STATE[cityName] || CITY_TO_STATE[cityName?.replace(/\s/g, "")] || null;
  const fileKey = state && mode ? `${state}_${mode}` : null;
  const fileData = fileKey ? DATA_MAP[fileKey] : null;
  const metricData = fileData && metric ? fileData[metric] : null;

  if (!metricData) {
    return (
      <div className="flex items-center justify-center h-[260px] text-gray-400 text-sm border border-gray-200 rounded-lg bg-gray-50">
        {!cityName || !metric ? "Select a city and metric to view the chart." : `No data available for ${metric} — ${cityName}.`}
      </div>
    );
  }

  const { labels, unit, tracts } = metricData;
  const tractIds = Object.keys(tracts);
  const ptRadius = mode === "R2" ? 5 : 4;

  // City average across all tracts
  const avgData = labels.map((_, i) => {
    const vals = tractIds.map(id => tracts[id][i]).filter(v => v != null && !isNaN(v));
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  });

  // ── Imperative helpers (hover only — no React re-render) ──────────────────

  const applyHover = (chart, hoverIdx) => {
    chart.data.datasets.forEach((ds, i) => {
      if (ds._isAvg) return;
      const base = ds._baseColor;
      if (i === hoverIdx) {
        ds.borderColor = base;
        ds.borderWidth = 2;
        ds.pointRadius = 0; // hover: no markers yet — click to lock
      } else {
        ds.borderColor = hexToRgba(base, 0.08);
        ds.borderWidth = 1;
        ds.pointRadius = 0;
      }
    });
    chart.update("none");
  };

  const clearHover = (chart) => {
    chart.data.datasets.forEach((ds, i) => {
      if (ds._isAvg) return;
      const base = ds._baseColor;
      const sel = selectedIdxRef.current;
      if (sel !== null) {
        // Restore to selection state
        if (i === sel) {
          ds.borderColor = base;
          ds.borderWidth = 3;
          ds.pointRadius = ptRadius;
        } else {
          ds.borderColor = hexToRgba(base, 0.6);
          ds.borderWidth = 1;
          ds.pointRadius = 0;
        }
      } else {
        // Restore to default faded state
        ds.borderColor = hexToRgba(base, 0.22);
        ds.borderWidth = 1;
        ds.pointRadius = 0;
      }
    });
    chart.update("none");
  };

  // ── Dataset styles — computed from selectedIdx (drives React render) ──────

  const tractDatasets = tractIds.map((tractId, idx) => {
    const color = TRACT_COLORS[idx % TRACT_COLORS.length];
    let borderColor, borderWidth, pointRadius, pointBorderWidth;

    if (selectedIdx === idx) {
      borderColor = color;
      borderWidth = 3;
      pointRadius = ptRadius;
      pointBorderWidth = 2;
    } else if (selectedIdx !== null) {
      borderColor = hexToRgba(color, 0.6);
      borderWidth = 1;
      pointRadius = 0;
      pointBorderWidth = 0;
    } else {
      borderColor = hexToRgba(color, 0.22);
      borderWidth = 1;
      pointRadius = 0;
      pointBorderWidth = 1.5;
    }

    return {
      label: `Tract ${tractId}`,
      data: tracts[tractId],
      borderColor,
      backgroundColor: "rgba(0,0,0,0)",
      borderWidth,
      pointStyle: "circle",
      pointRadius,
      pointHoverRadius: 6,
      pointBackgroundColor: "#ffffff",
      pointBorderColor: color,
      pointBorderWidth,
      tension: 0.4,
      _baseColor: color,
      _isAvg: false,
    };
  });

  const avgDataset = {
    label: "City Average",
    data: avgData,
    borderColor: "#1a1a1a",
    backgroundColor: "rgba(0,0,0,0)",
    borderWidth: 2.5,
    pointStyle: "circle",
    pointRadius: mode === "R2" ? 5 : 0,
    pointHoverRadius: 6,
    pointBackgroundColor: "#ffffff",
    pointBorderColor: "#1a1a1a",
    pointBorderWidth: 2,
    tension: 0.4,
    _baseColor: "#1a1a1a",
    _isAvg: true,
    order: 0,
  };

  const datasets = [...tractDatasets, avgDataset];
  const xLabel = mode === "R1" ? "Hour of Day" : "Year";

  // Compute y-axis step size
  const isFuel = FUEL_METRICS.has(metric);
  const modeOverrides = STEP_OVERRIDES[mode] || {};
  let yStepSize;
  if (modeOverrides[metric] != null) {
    yStepSize = modeOverrides[metric];
  } else if (mode === "R2" || isFuel) {
    let dataMax = 0;
    tractIds.forEach(id => tracts[id].forEach(v => { if (v > dataMax) dataMax = v; }));
    yStepSize = niceStepSize(dataMax);
  }

  const handleSelectIdx = (idx) => {
    const newIdx = selectedIdxRef.current === idx ? null : idx;
    selectedIdxRef.current = newIdx;
    setSelectedIdx(newIdx);
  };

  const handleReset = () => {
    selectedIdxRef.current = null;
    setSelectedIdx(null);
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    layout: { padding: { top: 22, right: 24, bottom: 0, left: 0 } },
    hover: { mode: "nearest", intersect: false },

    onHover: (_evt, activeElements, chart) => {
      const overTract =
        activeElements.length > 0 &&
        !chart.data.datasets[activeElements[0].datasetIndex]?._isAvg;
      chart.canvas.style.cursor = overTract ? "pointer" : "default";
      // Hover visual only when nothing is locked
      if (selectedIdxRef.current !== null) return;
      if (overTract) {
        applyHover(chart, activeElements[0].datasetIndex);
      } else {
        clearHover(chart);
      }
    },

    onClick: (_evt, activeElements, chart) => {
      if (activeElements.length > 0) {
        const idx = activeElements[0].datasetIndex;
        if (!chart.data.datasets[idx]?._isAvg) handleSelectIdx(idx);
      } else {
        handleReset();
      }
    },

    plugins: {
      legend: { display: false },
      tooltip: {
        mode: "nearest",
        intersect: false,
        backgroundColor: "#fff",
        titleColor: "#222",
        bodyColor: "#222",
        borderColor: "#ccc",
        borderWidth: 1,
        displayColors: true,
        callbacks: {
          title: (items) => items[0]?.label || "",
          label: (item) => ` ${item.dataset.label}: ${item.parsed.y?.toFixed(4)} ${unit}`,
          labelColor: (item) => ({
            borderColor: item.dataset._baseColor || "#1a1a1a",
            backgroundColor: "#ffffff",
          }),
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
        grid: {
          display: true,
          color: "rgba(169,169,169,0.45)",
          lineWidth: 0.8,
          borderDash: [3, 2],
        },
        ticks: {
          maxTicksLimit: mode === "R2" ? 7 : 24,
          maxRotation: 45,
          font: { size: 11 },
          color: "#444",
          padding: 4,
        },
        title: { display: true, text: xLabel, font: { size: 11 }, color: "#333", padding: { top: 0, bottom: 0 } },
      },
      xTop: {
        position: "top",
        border: { display: true, color: "#444", width: 1 },
        grid: { drawOnChartArea: false, drawTicks: false },
        ticks: { display: false },
      },
      y: {
        border: { display: true, color: "#444", width: 1 },
        grid: {
          display: true,
          color: "rgba(169,169,169,0.45)",
          lineWidth: 0.8,
          borderDash: [3, 2],
        },
        ticks: {
          font: { size: 11 }, color: "#444", padding: 4,
          ...(yStepSize ? { stepSize: yStepSize } : { maxTicksLimit: 8 }),
        },
        title: { display: true, text: unit, font: { size: 11 }, color: "#333", padding: { top: 0, bottom: 0 } },
      },
      yRight: {
        position: "right",
        border: { display: true, color: "#444", width: 1 },
        grid: { drawOnChartArea: false, drawTicks: false },
        ticks: { display: false },
      },
    },
  };

  return (
    <div ref={containerRef} className="w-full">
      {/* Top legend row */}
      <div className="flex items-center gap-5 mb-1.5 px-1">
        <div className="flex items-center gap-1.5">
          <svg width="30" height="12" style={{ flexShrink: 0 }}>
            <line x1="0" y1="6" x2="30" y2="6" stroke="#1a1a1a" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
          <span className="text-[10px] font-semibold text-gray-800">City Average</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="30" height="12" style={{ flexShrink: 0 }}>
            <line x1="0" y1="6" x2="30" y2="6" stroke="#888" strokeWidth="1" strokeLinecap="round" strokeOpacity="0.4" />
          </svg>
          <span className="text-[10px] text-gray-500">
            Census Tract <em>(hover to preview · click to lock)</em>
          </span>
        </div>
      </div>

      {/* Chart */}
      <div className="relative w-full h-[240px] border border-gray-400 rounded bg-white">
        <Line ref={chartRef} data={{ labels, datasets }} options={options} plugins={[chartBgPlugin]} />
        <ZoomToolbar chartRef={chartRef} />
      </div>

      {/* Compact clickable tract grid */}
      <div className="mt-2 border border-gray-100 rounded p-1.5 bg-gray-50">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[9px] text-gray-400 uppercase tracking-wide">
            Census Tracts — click to select
          </span>
          {selectedIdx !== null && (
            <button
              type="button"
              onClick={handleReset}
              className="text-[9px] text-blue-500 hover:text-blue-700 font-semibold"
            >
              Clear selection
            </button>
          )}
        </div>
        <div className="grid gap-x-2 gap-y-0.5" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          {tractIds.map((tractId, idx) => {
            const color = TRACT_COLORS[idx % TRACT_COLORS.length];
            const isSelected = selectedIdx === idx;
            const isFaded = selectedIdx !== null && !isSelected;
            return (
              <button
                key={tractId}
                type="button"
                onClick={() => handleSelectIdx(idx)}
                className="flex items-center gap-1 px-1 py-0.5 rounded text-left hover:bg-white transition-colors"
                style={{ opacity: isFaded ? 0.28 : 1 }}
                title={`Tract ${tractId}`}
              >
                <div
                  className="flex-shrink-0 rounded-full"
                  style={{
                    width: 8,
                    height: 8,
                    backgroundColor: color,
                    boxShadow: isSelected ? `0 0 0 2px #fff, 0 0 0 3.5px ${color}` : "none",
                  }}
                />
                <span className={`text-[9px] truncate ${isSelected ? "font-bold text-gray-900" : "text-gray-600"}`}>
                  {tractId}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
