import React, { useRef, useMemo, useCallback } from "react";
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
import { chartBgPlugin, subGridPlugin } from "../utils/chartConstants";

ChartJS.register(LinearScale, PointElement, LineElement, Title, Tooltip, zoomPlugin);

// Plugin: draw the right y-axis title bottom-to-top (Chart.js hardcodes it top-to-bottom)
// Matplotlib tab20 palette — matches the original plot colors and SVG tract map fills
export const TAB20 = [
  "#1f77b4", "#aec7e8", "#ff7f0e", "#ffbb78", "#2ca02c",
  "#98df8a", "#d62728", "#ff9896", "#9467bd", "#c5b0d5",
  "#8c564b", "#c49c94", "#e377c2", "#f7b6d2", "#7f7f7f",
  "#c7c7c7", "#bcbd22", "#dbdb8d", "#17becf", "#9edae5",
];

const formatTime = (hours) => {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
};

// Zoom toolbar matching existing project style
const ZoomToolbar = ({ chartRef }) => (
  <div className="absolute top-10 right-4 z-10 flex bg-white rounded border border-gray-300 shadow-sm overflow-hidden select-none">
    <button
      onClick={() => chartRef.current?.zoom(1.1)}
      className="px-3 py-1 text-blue-600 hover:bg-gray-50 border-r border-gray-200 text-lg font-bold leading-none transition-colors"
      title="Zoom In"
      type="button"
    >
      +
    </button>
    <button
      onClick={() => chartRef.current?.zoom(0.9)}
      className="px-3 py-1 text-blue-600 hover:bg-gray-50 border-r border-gray-200 text-lg font-bold leading-none transition-colors"
      title="Zoom Out"
      type="button"
    >
      -
    </button>
    <button
      onClick={() => chartRef.current?.resetZoom()}
      className="px-3 py-1 text-xs font-semibold text-blue-600 hover:bg-gray-50 uppercase tracking-wide transition-colors"
      title="Reset Zoom"
      type="button"
    >
      RESET
    </button>
  </div>
);

export default function TrafficChart({
  tractData, dataSource, city, year,
  activeTract = null,
  onTractHover,
}) {
  const chartRef = useRef(null);

  // Pre-compute data arrays (stable references — don't rebuild on highlight change)
  const processedTracts = useMemo(() => {
    if (!tractData?.length) return [];
    return tractData.map((tract, idx) => ({
      tractId: tract.tractId,
      color: TAB20[idx % TAB20.length],
      speedData: tract.time.map((t, i) => ({ x: t, y: tract.speed[i] })),
      volumeData: tract.time.map((t, i) => ({ x: t, y: tract.volume[i] })),
    }));
  }, [tractData]);

  // Build chart datasets — data refs stay stable, only styles change with activeTract
  const chartData = useMemo(() => {
    const datasets = [];
    processedTracts.forEach((tract) => {
      const { tractId, color, speedData, volumeData } = tract;
      const isActive = activeTract === tractId;
      const isDimmed = activeTract != null && !isActive;

      datasets.push({
        label: `Speed - ${tractId}`,
        data: speedData,
        borderColor: isDimmed ? color + "18" : color,
        backgroundColor: "transparent",
        borderWidth: isActive ? 3 : 1,
        pointRadius: 0,
        pointHoverRadius: isActive ? 4 : 0,
        tension: 0,
        yAxisID: "y",
        tractId,
        metricType: "speed",
        order: isActive ? 0 : 1,
      });

      datasets.push({
        label: `Volume - ${tractId}`,
        data: volumeData,
        borderColor: isDimmed ? color + "18" : color,
        backgroundColor: "transparent",
        borderWidth: isActive ? 3 : 1,
        borderDash: [6, 3],
        pointRadius: 0,
        pointHoverRadius: isActive ? 4 : 0,
        tension: 0,
        yAxisID: "y1",
        tractId,
        metricType: "volume",
        order: isActive ? 0 : 1,
      });
    });
    return { datasets };
  }, [processedTracts, activeTract]);

  // Compute y-axis max from data
  const yMax = useMemo(() => {
    if (!processedTracts.length) return 60;
    let max = 0;
    processedTracts.forEach((t) => {
      t.speedData.forEach((p) => { if (p.y > max) max = p.y; });
    });
    return Math.ceil(max / 10) * 10; // round up to nearest 10
  }, [processedTracts]);

  // Debounced hover handler — only fires when tract actually changes
  const lastHoveredRef = useRef(null);
  const onHoverTract = useCallback((tractId) => {
    if (tractId !== lastHoveredRef.current) {
      lastHoveredRef.current = tractId;
      onTractHover?.(tractId);
    }
  }, [onTractHover]);

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {
        mode: "nearest",
        intersect: false,
        axis: "xy",
      },
      onHover: (_event, elements, chart) => {
        if (elements.length > 0) {
          const ds = chart.data.datasets[elements[0].datasetIndex];
          onHoverTract(ds?.tractId || null);
        } else {
          onHoverTract(null);
        }
      },
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
            title: (items) => {
              if (!items?.length) return "";
              return `Tract ${items[0].dataset.tractId}`;
            },
            label: (item) => {
              const ds = item.dataset;
              const timeStr = formatTime(item.parsed.x);
              const sisterType = ds.metricType === "speed" ? "volume" : "speed";
              const sisterDs = item.chart.data.datasets.find(
                (d) => d.tractId === ds.tractId && d.metricType === sisterType
              );
              const sisterVal = sisterDs?.data[item.dataIndex]?.y;

              const speedVal = ds.metricType === "speed" ? item.parsed.y : sisterVal;
              const volVal = ds.metricType === "volume" ? item.parsed.y : sisterVal;

              return [
                `Time: ${timeStr}`,
                `Speed: ${speedVal?.toFixed(1) ?? "\u2014"} mph`,
                `Volume: ${volVal?.toFixed(1) ?? "\u2014"} veh/hr/ln`,
              ];
            },
            labelColor: (item) => {
              const t = processedTracts.find(
                (t) => t.tractId === item.dataset.tractId
              );
              const c = t?.color || "#ccc";
              return { borderColor: c, backgroundColor: c };
            },
          },
        },
        zoom: {
          limits: { x: { min: 0, max: 24 }, y: { min: 0 } },
          pan: { enabled: true, mode: "x" },
          zoom: {
            wheel: { enabled: true },
            pinch: { enabled: true },
            mode: "x",
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          min: 0,
          max: 24,
          ticks: {
            stepSize: 0.5,
            autoSkip: false,
            callback: (value) => (Number.isInteger(value) ? value : ""),
            font: { size: 13 },
            color: "#444",
            maxRotation: 0,
          },
          title: { display: true, text: "Time (hr)", font: { size: 15 }, color: "#444" },
          grid: { color: "rgba(0,0,0,0.05)", lineWidth: 0.5, drawTicks: false },
          border: { color: "#444" },
        },
        y: {
          type: "linear",
          position: "left",
          min: 0,
          max: yMax,
          title: {
            display: true,
            text: "Traffic Speed (mph)",
            font: { size: 15 },
            color: "#444",
          },
          ticks: {
            stepSize: 5,
            autoSkip: false,
            callback: (value) => (value % 10 === 0 ? value : ""),
            font: { size: 13 },
            color: "#444",
          },
          grid: { color: "rgba(0,0,0,0.05)", lineWidth: 0.5, drawTicks: false },
          border: { color: "#444" },
        },
        y1: {
          type: "linear",
          position: "right",
          title: { display: false },
          ticks: { font: { size: 13 }, color: "#444" },
          grid: { drawOnChartArea: false },
          border: { color: "#444" },
        },
        xTop: {
          position: "top",
          border: { display: true, color: "#444", width: 1 },
          grid: { drawOnChartArea: false, drawTicks: false },
          ticks: { display: false },
        },
      },
    }),
    [onHoverTract, processedTracts, yMax]
  );

  if (!tractData?.length) return null;

  return (
    <div className="w-full">
      {/* Chart area */}
      <div
        className="relative border border-gray-200 rounded-lg bg-white shadow-sm"
        onMouseLeave={() => onHoverTract(null)}
      >
        <div className="text-center text-base font-semibold text-gray-700 pt-3 pb-1">
          Year {year} - {city} [{dataSource}]
        </div>
        <div style={{ display: "flex", alignItems: "stretch" }}>
          <div style={{ flex: 1, padding: "0 8px 8px", height: 280 }}>
            <Line ref={chartRef} data={chartData} options={options} plugins={[chartBgPlugin, subGridPlugin]} />
          </div>
          <div style={{ display: "flex", alignItems: "center", width: 22, marginBottom: 40 }}>
            <span style={{
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
              fontSize: 14,
              color: "#444",
              whiteSpace: "nowrap",
              letterSpacing: "0.02em",
            }}>
              Traffic Volume (veh/hr/ln)
            </span>
          </div>
        </div>
        <ZoomToolbar chartRef={chartRef} />
      </div>

      {/* Compact line style legend */}
      <div className="flex items-center justify-center gap-6 text-xs text-gray-500 mt-2">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-5 border-t-2 border-gray-500" />
          <span>Speed (mph)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-5 border-t-2 border-dashed border-gray-500" />
          <span>Volume (veh/hr/ln)</span>
        </div>
      </div>
    </div>
  );
}
