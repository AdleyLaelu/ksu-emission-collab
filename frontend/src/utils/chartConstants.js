/** Shared constants and helpers for chart components */

export const CITY_TO_STATE = {
  Atlanta: "GA",
  "Los Angeles": "CA",
  LosAngeles: "CA",
  NewYork: "NY",
  Seattle: "WA",
};

/** Chart.js plugin that paints the chart area white (prevents transparent backgrounds). */
export const chartBgPlugin = {
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

/** Common font config used across all chart axes. */
export const CHART_FONT = { size: 14 };

/** Like subGridPlugin but only draws horizontal mid-lines (y-axis only). */
export const subGridYPlugin = {
  id: "subGridY",
  afterDraw(chart) {
    const { ctx, chartArea, scales: { y } } = chart;
    if (!chartArea || !y || y.ticks.length < 2) return;
    const gap = Math.abs(y.getPixelForTick(1) - y.getPixelForTick(0));
    if (gap <= 20) return;
    ctx.save();
    ctx.strokeStyle = "rgba(169,169,169,0.15)";
    ctx.lineWidth = 0.8;
    for (let i = 0; i < y.ticks.length - 1; i++) {
      const mid = (y.getPixelForTick(i) + y.getPixelForTick(i + 1)) / 2;
      ctx.beginPath();
      ctx.moveTo(chartArea.left, mid);
      ctx.lineTo(chartArea.right, mid);
      ctx.stroke();
    }
    ctx.restore();
  },
};

/** Draws extra lines between ticks to create square-ish grid cells.
 *  Only subdivides an axis when the pixel gap between ticks is large enough (> 20px). */
export const subGridPlugin = {
  id: "subGrid",
  afterDraw(chart) {
    const { ctx, chartArea, scales: { x, y } } = chart;
    if (!chartArea) return;
    ctx.save();
    ctx.strokeStyle = "rgba(169,169,169,0.15)";
    ctx.lineWidth = 0.8;
    const MIN_GAP = 20;
    if (y && y.ticks.length >= 2) {
      const gap = Math.abs(y.getPixelForTick(1) - y.getPixelForTick(0));
      if (gap > MIN_GAP) {
        for (let i = 0; i < y.ticks.length - 1; i++) {
          const mid = (y.getPixelForTick(i) + y.getPixelForTick(i + 1)) / 2;
          ctx.beginPath();
          ctx.moveTo(chartArea.left, mid);
          ctx.lineTo(chartArea.right, mid);
          ctx.stroke();
        }
      }
    }
    if (x && x.ticks.length >= 2) {
      const gap = Math.abs(x.getPixelForTick(1) - x.getPixelForTick(0));
      if (gap > MIN_GAP) {
        for (let i = 0; i < x.ticks.length - 1; i++) {
          const mid = (x.getPixelForTick(i) + x.getPixelForTick(i + 1)) / 2;
          ctx.beginPath();
          ctx.moveTo(mid, chartArea.top);
          ctx.lineTo(mid, chartArea.bottom);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  },
};
