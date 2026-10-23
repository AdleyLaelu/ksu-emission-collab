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
import useAppStore from "../useAppStore";

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
  "firebrick",      // Scenario 7 — Low RE + High Gas
  "teal",           // Scenario 8 — High RE + Low Gas
];

const EMISSION_LABELS = {
  CO2: "CO₂ (ton/MWh)",
  CH4: "CH₄ (g/MWh)",
  N2O: "N₂O (g/MWh)",
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

  // Read the user's selected simulation period from the store
  // (must be called before any early return to satisfy Rules of Hooks)
  const userBaseYear = parseInt(useAppStore((s) => s.classificationState.baseYear), 10) || null;
  const userEndYear = parseInt(useAppStore((s) => s.penetrationState.projectedYear), 10) || null;

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

  // Display names match JSON keys from Prophet forecast data
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
  const allDates = (scenarios[scenarioNames[0]] || []).map((p) => p.date);
  const MONTH_ABBRS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  // Determine the display year range: intersect user period with available data
  const allYearsSet = [...new Set(allDates.map((d) => parseInt(d.substring(0, 4), 10)))];
  const dataMinYear = Math.min(...allYearsSet);
  const dataMaxYear = Math.max(...allYearsSet);
  // Grid projections start after the base year (baseYear+1) and cap at available data
  const displayStartYear = userBaseYear ? Math.max(userBaseYear + 1, dataMinYear) : dataMinYear;
  const displayEndYear = userEndYear ? Math.min(userEndYear, dataMaxYear) : dataMaxYear;

  // Filter date indices to the display range
  const filteredIndices = allDates.reduce((acc, d, i) => {
    const y = parseInt(d.substring(0, 4), 10);
    if (y >= displayStartYear && y <= displayEndYear) acc.push(i);
    return acc;
  }, []);

  const rawDates = filteredIndices.map((i) => allDates[i]);

  // Convert date strings to month abbreviations for display
  const labels = rawDates.map((d) => {
    const monthIdx = parseInt(d.substring(5, 7), 10) - 1;
    return MONTH_ABBRS[monthIdx] || "";
  });
  // Extract unique years for the year labels plugin
  const years = [...new Set(rawDates.map((d) => d.substring(0, 4)))];

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

  // Compute nice y-axis step for major + minor ticks (using only filtered data)
  const allValues = scenarioNames.flatMap((name) => {
    const pts = scenarios[name] || [];
    return filteredIndices.map((i) => pts[i]?.value ?? 0);
  });
  const dataMax = Math.max(...allValues);
  const yRough = dataMax / 6;
  const yMag = Math.pow(10, Math.floor(Math.log10(yRough || 1)));
  const yRes = yRough / yMag;
  const yMajorStep = (yRes <= 1 ? 1 : yRes <= 2 ? 2 : yRes <= 5 ? 5 : 10) * yMag;
  const yMinorStep = yMajorStep / 2;

  const forecastDatasets = scenarioNames.map((name, idx) => {
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
      data: filteredIndices.map((i) => (scenarios[name] || [])[i]?.value ?? null),
      borderColor,
      backgroundColor: "rgba(0,0,0,0)",
      borderWidth,
      pointRadius: 0,
      tension: 0.4,
      _baseColor: color,
    };
  });

  const datasets = forecastDatasets;

  const handleSelectIdx = (idx) => {
    const newIdx = selectedIdxRef.current === idx ? null : idx;
    if (isControlled) { onSelect?.(newIdx); } else { selectedIdxRef.current = newIdx; setInternalIdx(newIdx); }
  };

  const handleReset = () => {
    if (isControlled) { onSelect?.(null); } else { selectedIdxRef.current = null; setInternalIdx(null); }
  };

  const yLabel = EMISSION_LABELS[emissionType] || emissionType;

  // Plugin to draw year labels below the x-axis, spaced to avoid overlap
  const yearLabelsPlugin = {
    id: "yearLabels",
    afterDraw(chart) {
      const xScale = chart.scales.x;
      const ctx = chart.ctx;
      ctx.save();
      ctx.font = "12px Inter, sans-serif";
      ctx.fillStyle = "#222";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const yPos = xScale.bottom + 8;
      // Dynamically choose step to avoid overlap: aim for ~5-7 labels max
      const nYears = years.length;
      const step = nYears <= 7 ? 1 : nYears <= 14 ? 2 : 5;
      for (let yearIdx = 0; yearIdx < nYears; yearIdx += step) {
        const startIdx = yearIdx * 12;
        const endIdx = Math.min(startIdx + 11, labels.length - 1);
        const x1 = xScale.getPixelForValue(startIdx);
        const x2 = xScale.getPixelForValue(endIdx);
        const centerX = (x1 + x2) / 2;
        ctx.fillText(years[yearIdx], centerX, yPos);
      }
      ctx.restore();
    },
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    layout: { padding: { top: 22, right: 24, bottom: 40, left: 0 } },
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
            const idx = items[0]?.dataIndex;
            if (idx == null) return items[0]?.label || "";
            const month = labels[idx] || "";
            const yearIdx = Math.floor(idx / 12);
            const year = years[yearIdx] || "";
            return `${month} ${year}`;
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
          font: { ...CHART_FONT, size: 11 },
          color: "#222",
          maxRotation: 90,
          minRotation: 90,
          padding: 6,
          autoSkip: false,
          callback: function(_value, index) {
            // Show Jan and Jul only (every 6 months)
            if (index % 12 === 0) return "Jan";
            if (index % 12 === 6) return "Jul";
            return "";
          },
        },
        title: { display: false },
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
          lineWidth: 0.8,
          drawTicks: true,
          tickColor: "#444",
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
      {/* Chart — fills parent height, fallback 200px when no parent height set */}
      <div className="relative w-full flex-1 bg-white" style={{ minHeight: 280 }}>
        <Line ref={chartRef} data={{ labels, datasets }} options={options} plugins={[chartBgPlugin, subGridThirdsYPlugin, yearLabelsPlugin]} />
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
