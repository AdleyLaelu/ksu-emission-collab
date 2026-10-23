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
import { SCENARIO_COLORS } from "./GridChartR3";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, zoomPlugin);

import GA_GridEmissions from "../assets/r1r2data/GA_GridEmissions.json";
import CA_GridEmissions from "../assets/r1r2data/CA_GridEmissions.json";

const DATA_MAP = { GA: GA_GridEmissions, CA: CA_GridEmissions };

const EMISSION_LABELS = {
  CO2: "CO\u2082 (tons)",
  CH4: "CH\u2084 (grams)",
  N2O: "N\u2082O (grams)",
};

const DISPLAY_NAMES = [
  "Mid-case Scenario",
  "Low Renewable Energy and Battery Costs",
  "High Renewable Energy and Battery Costs",
  "High Demand Growth",
  "Low Natural Gas Prices",
  "High Natural Gas Prices",
  "Low RE & Battery Costs + High Gas Prices",
  "High RE & Battery Costs + Low Gas Prices",
];

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
      className="px-2 py-0.5 text-blue-600 hover:bg-gray-50 border-r border-gray-200 text-sm font-bold leading-none" title="Zoom Out">&minus;</button>
    <button type="button" onClick={() => chartRef.current?.resetZoom()}
      className="px-2 py-0.5 text-[10px] font-semibold text-blue-600 hover:bg-gray-50 uppercase tracking-wide" title="Reset Zoom">Reset</button>
  </div>
);

const GridEmissionsChart = forwardRef(function GridEmissionsChart({ emissionType, cityName, showLegend = true, controlledIdx = undefined, onSelect, overrideData = null }, ref) {
  const isControlled = controlledIdx !== undefined;
  const chartRef = useRef(null);
  useImperativeHandle(ref, () => ({ getChart: () => chartRef.current }), []);
  const containerRef = useRef(null);
  const [internalIdx, setInternalIdx] = useState(null);
  const selectedIdx = isControlled ? controlledIdx : internalIdx;
  const selectedIdxRef = useRef(selectedIdx);

  useEffect(() => { selectedIdxRef.current = selectedIdx; }, [selectedIdx]);

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
  const jsonData = overrideData || (state ? DATA_MAP[state] : null);

  if (!jsonData) {
    return (
      <div className="flex items-center justify-center h-[260px] text-gray-400 text-sm border border-gray-200 rounded-lg bg-gray-50">
        No grid emissions data available{cityName ? ` for ${cityName}` : ""}.
        {(state === "NY" || state === "WA") && " (No traffic data for this state.)"}
      </div>
    );
  }

  const scenarios = jsonData.scenarios || {};
  const scenarioNames = Object.keys(scenarios);
  const gasData = scenarios[scenarioNames[0]]?.[emissionType];
  if (!gasData) {
    return (
      <div className="flex items-center justify-center h-[260px] text-gray-400 text-sm border border-gray-200 rounded-lg bg-gray-50">
        No {emissionType} grid emissions data available.
      </div>
    );
  }

  const labels = gasData.labels; // ["2025", "2026", ..., "2030"]

  // Build datasets from studyAreaTotal for each scenario
  const allValues = scenarioNames.flatMap((name) =>
    (scenarios[name]?.[emissionType]?.studyAreaTotal || [])
  );
  const dataMax = Math.max(...allValues);
  const yRough = dataMax / 6;
  const yMag = Math.pow(10, Math.floor(Math.log10(yRough || 1)));
  const yRes = yRough / yMag;
  const yMajorStep = (yRes <= 1 ? 1 : yRes <= 2 ? 2 : yRes <= 5 ? 5 : 10) * yMag;
  const yMinorStep = yMajorStep / 2;

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
        if (i === sel) { ds.borderColor = base; ds.borderWidth = 3; }
        else { ds.borderColor = toRgba(base, 0.6); ds.borderWidth = 1; }
      } else {
        ds.borderColor = toRgba(base, 0.7); ds.borderWidth = 1.5;
      }
    });
    chart.update("none");
  };

  const datasets = scenarioNames.map((name, idx) => {
    const color = SCENARIO_COLORS[idx % SCENARIO_COLORS.length];
    const data = scenarios[name]?.[emissionType]?.studyAreaTotal || [];
    let borderColor, borderWidth;
    if (selectedIdx === idx) { borderColor = color; borderWidth = 3; }
    else if (selectedIdx !== null) { borderColor = toRgba(color, 0.6); borderWidth = 1; }
    else { borderColor = toRgba(color, 0.7); borderWidth = 1.5; }

    return {
      label: name,
      data,
      borderColor,
      backgroundColor: "rgba(0,0,0,0)",
      borderWidth,
      pointRadius: 3,
      pointHoverRadius: 5,
      tension: 0.3,
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
    layout: { padding: { top: 22, right: 24, bottom: 10, left: 0 } },
    hover: { mode: "nearest", intersect: false },
    onHover: (_evt, activeElements, chart) => {
      chart.canvas.style.cursor = activeElements.length > 0 ? "pointer" : "default";
      if (selectedIdxRef.current !== null) return;
      if (activeElements.length > 0) { applyHover(chart, activeElements[0].datasetIndex); }
      else { clearHover(chart); }
    },
    onClick: (_evt, activeElements) => {
      if (activeElements.length > 0) { handleSelectIdx(activeElements[0].datasetIndex); }
      else { handleReset(); }
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
        grid: { display: true, color: "rgba(169,169,169,0.15)", lineWidth: 0.8, drawTicks: true, tickColor: "#444" },
        ticks: { font: { ...CHART_FONT, size: 11 }, color: "#222", padding: 6 },
        title: { display: true, text: "Year", font: CHART_FONT, color: "#222" },
      },
      y: {
        border: { display: true, color: "#444", width: 1 },
        grid: {
          display: true,
          color: (ctx) => {
            const remainder = yMajorStep > 0 ? Math.abs(ctx.tick.value % yMajorStep) : 0;
            const isMajor = remainder < 1e-10 || Math.abs(remainder - yMajorStep) < 1e-10;
            return isMajor ? "rgba(169,169,169,0.15)" : "transparent";
          },
          lineWidth: 0.8, drawTicks: true, tickColor: "#444",
        },
        ticks: {
          font: CHART_FONT, color: "#222", padding: 4,
          stepSize: yMinorStep,
          callback: (value) => {
            const remainder = yMajorStep > 0 ? Math.abs(value % yMajorStep) : 0;
            if (remainder < 1e-10 || Math.abs(remainder - yMajorStep) < 1e-10) return value;
            return "";
          },
          maxTicksLimit: 30,
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
      <div className="relative w-full flex-1 bg-white" style={{ minHeight: 280 }}>
        <Line ref={chartRef} data={{ labels, datasets }} options={options} plugins={[chartBgPlugin, subGridThirdsYPlugin]} />
        <ZoomToolbar chartRef={chartRef} />
      </div>
      {showLegend && (
        <div className="border border-gray-500 rounded-xl bg-white p-2 shadow-md w-full">
          {selectedIdx !== null && (
            <button type="button" onClick={handleReset} className="text-[9px] text-blue-500 hover:text-blue-700 font-semibold mb-1">Clear</button>
          )}
          <div className="grid grid-cols-1 gap-y-0.5">
            {scenarioNames.map((name, idx) => {
              const color = SCENARIO_COLORS[idx % SCENARIO_COLORS.length];
              const isSelected = selectedIdx === idx;
              const isFaded = selectedIdx !== null && !isSelected;
              return (
                <button key={name} type="button" onClick={() => handleSelectIdx(idx)}
                  className="flex items-center gap-1.5 py-0.5 hover:opacity-80 transition-opacity"
                  style={{ opacity: isFaded ? 0.28 : 1 }}>
                  <svg width="22" height="8" style={{ flexShrink: 0 }}>
                    <line x1="0" y1="4" x2="22" y2="4" stroke={color} strokeWidth={isSelected ? 2.5 : 1.5} strokeLinecap="round" />
                  </svg>
                  <span className={`text-[11px] text-left whitespace-nowrap ${isSelected ? "font-bold text-gray-900" : "font-bold text-gray-700"}`}>
                    {DISPLAY_NAMES[idx] || name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});

export default GridEmissionsChart;
