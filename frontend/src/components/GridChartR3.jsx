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
import { CITY_TO_STATE, chartBgPlugin, CHART_FONT, subGridThirdsYPlugin } from "../utils/chartConstants";

import GA_CO2 from "../assets/r3data/GA_CO2.json";
import GA_CH4 from "../assets/r3data/GA_CH4.json";
import GA_N2O from "../assets/r3data/GA_N2O.json";
import CA_CO2 from "../assets/r3data/CA_CO2.json";
import CA_CH4 from "../assets/r3data/CA_CH4.json";
import CA_N2O from "../assets/r3data/CA_N2O.json";
import NY_CO2 from "../assets/r3data/NY_CO2.json";
import NY_CH4 from "../assets/r3data/NY_CH4.json";
import NY_N2O from "../assets/r3data/NY_N2O.json";
import WA_CO2 from "../assets/r3data/WA_CO2.json";
import WA_CH4 from "../assets/r3data/WA_CH4.json";
import WA_N2O from "../assets/r3data/WA_N2O.json";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, zoomPlugin);

const DATA_MAP = {
  GA_CO2, GA_CH4, GA_N2O,
  CA_CO2, CA_CH4, CA_N2O,
  NY_CO2, NY_CH4, NY_N2O,
  WA_CO2, WA_CH4, WA_N2O,
};


const SCENARIO_COLORS = [
  "gold",           // Scenario 1 — Mid-case
  "darkorange",     // Scenario 2 — Low Renewable Energy
  "mediumseagreen", // Scenario 3 — High Renewable Energy
  "steelblue",      // Scenario 4 — High Demand Growth
  "orchid",         // Scenario 5 — Low Natural Gas Prices
  "slateblue",      // Scenario 6 — High Natural Gas Prices
  "firebrick",      // Scenario 7 — 95% Decarbonization
  "teal",           // Scenario 8 — 100% Decarbonization
];

const EMISSION_LABELS = {
  CO2: "CO₂ (lb/MWh)",
  CH4: "CH₄ (lb/MWh)",
  N2O: "N₂O (lb/MWh)",
};

// Resolve any CSS color (named or hex) to rgba via a temporary canvas.
// Lazy-initialized to avoid crashing in SSR/test environments where document is undefined.
let _colorCtx;
function toRgba(color, alpha) {
  if (!_colorCtx) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    _colorCtx = c.getContext("2d");
  }
  _colorCtx.clearRect(0, 0, 1, 1);
  _colorCtx.fillStyle = color;
  _colorCtx.fillRect(0, 0, 1, 1);
  const [r, g, b] = _colorCtx.getImageData(0, 0, 1, 1).data;
  return `rgba(${r},${g},${b},${alpha})`;
}


const ZoomToolbar = ({ chartRef }) => (
  <div className="absolute top-2 right-2 z-10 flex bg-white rounded border border-gray-300 shadow-sm overflow-hidden select-none">
    <button type="button" onClick={() => chartRef.current?.zoom(1.2)}
      className="px-2 py-0.5 text-blue-600 hover:bg-gray-50 border-r border-gray-200 text-sm font-bold leading-none" title="Zoom In">+</button>
    <button type="button" onClick={() => chartRef.current?.zoom(0.8)}
      className="px-2 py-0.5 text-blue-600 hover:bg-gray-50 border-r border-gray-200 text-sm font-bold leading-none" title="Zoom Out">−</button>
    <button type="button" onClick={() => chartRef.current?.resetZoom()}
      className="px-2 py-0.5 text-[10px] font-semibold text-blue-600 hover:bg-gray-50 uppercase tracking-wide" title="Reset Zoom">Reset</button>
  </div>
);

export { SCENARIO_COLORS };

const GridChartR3 = forwardRef(function GridChartR3({ emissionType, cityName, showLegend = true, controlledIdx = undefined, onSelect }, ref) {
  const isControlled = controlledIdx !== undefined;
  const chartRef = useRef(null);
  useImperativeHandle(ref, () => ({ getChart: () => chartRef.current }), []);
  const containerRef = useRef(null);
  const [internalIdx, setInternalIdx] = useState(null);
  const selectedIdx = isControlled ? controlledIdx : internalIdx;
  const selectedIdxRef = useRef(selectedIdx);

  // Keep ref in sync
  useEffect(() => { selectedIdxRef.current = selectedIdx; }, [selectedIdx]);

  // Clear selection when clicking outside the chart card
  useEffect(() => {
    const onClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        if (selectedIdxRef.current !== null) {
          if (isControlled) { onSelect?.(null); } else { setInternalIdx(null); }
          selectedIdxRef.current = null;
        }
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [isControlled, onSelect]);

  const state = CITY_TO_STATE[cityName] || CITY_TO_STATE[cityName?.replace(/\s/g, "")] || null;
  const key = state && emissionType ? `${state}_${emissionType}` : null;
  const jsonData = key ? DATA_MAP[key] : null;

  if (!jsonData) {
    return (
      <div className="flex items-center justify-center h-[260px] text-gray-400 text-sm border border-gray-200 rounded-lg bg-gray-50">
        {!cityName || !emissionType
          ? "Select a city and emission type to view the chart."
          : `No data available for ${emissionType} — ${cityName}.`}
      </div>
    );
  }

  const scenarios = jsonData.scenarios || {};
  const scenarioNames = Object.keys(scenarios);

  // Map truncated JSON keys to full display names
  const DISPLAY_NAMES = [
    "Mid-case Scenario",
    "Low Renewable Energy and Battery Costs",
    "High Renewable Energy and Battery Costs",
    "High Demand Growth",
    "Low Natural Gas Prices",
    "High Natural Gas Prices",
    "Low Renewable Energy & Battery Costs + High Gas Prices",
    "High Renewable Energy & Battery Costs + Low Gas Prices",
  ];
  const labels = (scenarios[scenarioNames[0]] || []).map((p) => p.date);

  // ── Imperative hover helpers ──────────────────────────────────────────────

  const applyHover = (chart, hoverIdx) => {
    chart.data.datasets.forEach((ds, i) => {
      const base = ds._baseColor;
      if (i === hoverIdx) {
        ds.borderColor = base;
        ds.borderWidth = 2.5;
      } else {
        ds.borderColor = toRgba(base, 0.1);
        ds.borderWidth = 1;
      }
    });
    chart.update("none");
  };

  const clearHover = (chart) => {
    const sel = selectedIdxRef.current;
    chart.data.datasets.forEach((ds, i) => {
      const base = ds._baseColor;
      if (sel !== null) {
        if (i === sel) {
          ds.borderColor = base;
          ds.borderWidth = 3;
        } else {
          ds.borderColor = toRgba(base, 0.6);
          ds.borderWidth = 1;
        }
      } else {
        ds.borderColor = toRgba(base, 0.7);
        ds.borderWidth = 1.5;
      }
    });
    chart.update("none");
  };

  // ── Dataset styles from selectedIdx ──────────────────────────────────────

  const datasets = scenarioNames.map((name, idx) => {
    const color = SCENARIO_COLORS[idx % SCENARIO_COLORS.length];
    let borderColor, borderWidth;

    if (selectedIdx === idx) {
      borderColor = color;
      borderWidth = 3;
    } else if (selectedIdx !== null) {
      borderColor = toRgba(color, 0.6);
      borderWidth = 1;
    } else {
      borderColor = toRgba(color, 0.7);
      borderWidth = 1.5;
    }

    return {
      label: name,
      data: (scenarios[name] || []).map((p) => p.value),
      borderColor,
      backgroundColor: "rgba(0,0,0,0)",
      borderWidth,
      pointRadius: 0,
      tension: 0.4,
      _baseColor: color,
    };
  });

  const handleSelectIdx = (idx) => {
    const newIdx = selectedIdxRef.current === idx ? null : idx;
    if (isControlled) { onSelect?.(newIdx); } else { selectedIdxRef.current = newIdx; setInternalIdx(newIdx); }
  };

  const handleReset = () => {
    if (isControlled) { onSelect?.(null); } else { selectedIdxRef.current = null; setInternalIdx(null); }
  };

  const yLabel = EMISSION_LABELS[emissionType] || emissionType;

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    layout: { padding: { top: 22, right: 24, bottom: 0, left: 0 } },
    hover: { mode: "nearest", intersect: false },

    onHover: (_evt, activeElements, chart) => {
      chart.canvas.style.cursor = activeElements.length > 0 ? "pointer" : "default";
      if (selectedIdxRef.current !== null) return;
      if (activeElements.length > 0) {
        applyHover(chart, activeElements[0].datasetIndex);
      } else {
        clearHover(chart);
      }
    },

    onClick: (_evt, activeElements, chart) => {
      if (activeElements.length > 0) {
        handleSelectIdx(activeElements[0].datasetIndex);
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
          title: (items) => {
            const raw = (items[0]?.label || "").replace(/\s+00:00:00$/, "");
            const parts = raw.split("-");
            if (parts.length < 2) return raw;
            const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
            const monthIdx = parseInt(parts[1], 10) - 1;
            return `${months[monthIdx] || parts[1]}-${parts[0]}`;
          },
          label: (item) => ` ${item.dataset.label}: ${item.parsed.y?.toFixed(4)}`,
          labelColor: (item) => ({
            borderColor: item.dataset._baseColor,
            backgroundColor: item.dataset._baseColor,
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
          color: "rgba(169,169,169,0.15)",
          lineWidth: 0.8,
          drawTicks: true,
          tickColor: "#444",
        },
        ticks: {
          font: CHART_FONT,
          color: "#222",
          maxRotation: 0,
          padding: 4,
          autoSkip: false,
          callback: (_, index) => {
            const label = labels[index];
            if (!label) return "";
            // label format: "2025-01-01 00:00:00"
            const year = label.substring(0, 4);
            const month = label.substring(5, 7);
            // Show year label on January of each year
            return month === "01" ? year : "";
          },
        },
        title: { display: false },
      },
      y: {
        border: { display: true, color: "#444", width: 1 },
        grid: {
          display: true,
          color: "rgba(169,169,169,0.15)",
          lineWidth: 0.8,
          drawTicks: false,
        },
        ticks: {
          font: CHART_FONT, color: "#222", padding: 4,
          ...(emissionType === "CH4" ? { stepSize: 20 } : { maxTicksLimit: 6 }),
        },
        title: { display: true, text: yLabel, font: CHART_FONT, color: "#222", padding: { top: 0, bottom: 0 } },
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

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col">
      {/* Chart — fills parent height, fallback 200px when no parent height set */}
      <div className="relative w-full flex-1 bg-white" style={{ minHeight: 280 }}>
        <Line ref={chartRef} data={{ labels, datasets }} options={options} plugins={[chartBgPlugin, subGridThirdsYPlugin]} />
        <ZoomToolbar chartRef={chartRef} />
      </div>

      {/* Legend — single column below chart */}
      {showLegend && <div className="border border-gray-500 rounded-xl bg-white p-2 shadow-md w-full">
        {selectedIdx !== null && (
          <button type="button" onClick={handleReset} className="text-[9px] text-blue-500 hover:text-blue-700 font-semibold mb-1">Clear</button>
        )}
        <div className="grid grid-cols-1 gap-y-0.5">
          {scenarioNames.map((name, idx) => {
            const color = SCENARIO_COLORS[idx % SCENARIO_COLORS.length];
            const isSelected = selectedIdx === idx;
            const isFaded = selectedIdx !== null && !isSelected;
            return (
              <button
                key={name}
                type="button"
                onClick={() => handleSelectIdx(idx)}
                className="flex items-center gap-1.5 py-0.5 hover:opacity-80 transition-opacity"
                style={{ opacity: isFaded ? 0.28 : 1 }}
              >
                <svg width="22" height="8" style={{ flexShrink: 0 }}>
                  <line x1="0" y1="4" x2="22" y2="4" stroke={color}
                    strokeWidth={isSelected ? 2.5 : 1.5} strokeLinecap="round" />
                </svg>
                <span className={`text-[11px] text-left whitespace-nowrap ${isSelected ? "font-bold text-gray-900" : "font-bold text-gray-700"}`}>
                  {DISPLAY_NAMES[idx] || name}
                </span>
              </button>
            );
          })}
        </div>
      </div>}
    </div>
  );
});

export default GridChartR3;
