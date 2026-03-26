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
export const CHART_FONT = { size: 14, weight: "540" };
