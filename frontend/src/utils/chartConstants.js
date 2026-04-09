/** Shared constants and helpers for chart components */

export const CITY_TO_STATE = {
  Atlanta: "GA",
  "Los Angeles": "CA",
  LosAngeles: "CA",
  "New York": "NY",
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

/** Draws evenly spaced subdivision lines between major ticks on one axis. */
function drawSubLines(ctx, chartArea, scale, isVertical, divisions, minGap) {
  if (!scale || scale.ticks.length < 2 || divisions < 1) return;
  const gap = Math.abs(scale.getPixelForTick(1) - scale.getPixelForTick(0));
  if (gap <= minGap) return;
  const slots = divisions + 1;
  for (let i = 0; i < scale.ticks.length - 1; i++) {
    const p1 = scale.getPixelForTick(i);
    const p2 = scale.getPixelForTick(i + 1);
    for (let s = 1; s <= divisions; s++) {
      const pos = p1 + (p2 - p1) * (s / slots);
      ctx.beginPath();
      if (isVertical) {
        ctx.moveTo(pos, chartArea.top);
        ctx.lineTo(pos, chartArea.bottom);
      } else {
        ctx.moveTo(chartArea.left, pos);
        ctx.lineTo(chartArea.right, pos);
      }
      ctx.stroke();
    }
  }
}

/** Creates a Chart.js plugin that draws sub-grid lines between major ticks.
 *  xDiv/yDiv = extra lines per gap (1 = midpoint, 2 = thirds, 0 = none). */
export function makeSubGridPlugin(id, { xDiv = 0, yDiv = 0, minGap = 20 } = {}) {
  return {
    id,
    afterDraw(chart) {
      const { ctx, chartArea, scales: { x, y } } = chart;
      if (!chartArea) return;
      ctx.save();
      ctx.strokeStyle = "rgba(169,169,169,0.15)";
      ctx.lineWidth = 0.8;
      drawSubLines(ctx, chartArea, y, false, yDiv, minGap);
      drawSubLines(ctx, chartArea, x, true, xDiv, minGap);
      ctx.restore();
    },
  };
}

/** Midpoint on both axes (TrafficChart, VehicleChartR1R2 R1 mode). */
export const subGridPlugin = makeSubGridPlugin("subGrid", { xDiv: 1, yDiv: 1 });

/** Thirds on Y, midpoint on X (GridChartR3, VehicleChartR1R2 R2 mode). */
export const subGridThirdsYPlugin = makeSubGridPlugin("subGridThirdsY", { xDiv: 1, yDiv: 2 });

/** Midpoint on Y, thirds on X (VEC consumption/emission charts). */
export const subGridThirdsXPlugin = makeSubGridPlugin("subGridThirdsX", { xDiv: 2, yDiv: 1 });
