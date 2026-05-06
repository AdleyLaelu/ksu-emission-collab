import { jsPDF } from "jspdf";

/**
 * Export an array of Chart.js instances as a multi-page PDF.
 * @param {{ chart: object, title: string }[]} charts
 * @param {string} filename
 */
export default function downloadPlotsPdf(charts, filename = "plots.pdf") {
  if (!charts || charts.length === 0) return;

  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 40;

  charts.forEach(({ chart, title }, idx) => {
    if (idx > 0) pdf.addPage();

    // Title
    pdf.setFontSize(14);
    pdf.text(title, margin, margin);

    // Chart image
    const imgData = chart.toBase64Image("image/png", 1);
    const availW = pageW - margin * 2;
    const availH = pageH - margin * 2 - 20; // 20pt for title space
    const canvas = chart.canvas;
    const ratio = Math.min(availW / canvas.width, availH / canvas.height);
    const imgW = canvas.width * ratio;
    const imgH = canvas.height * ratio;

    pdf.addImage(imgData, "PNG", margin, margin + 20, imgW, imgH);
  });

  pdf.save(filename);
}
