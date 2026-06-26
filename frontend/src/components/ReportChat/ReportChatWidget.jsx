import { useState } from "react";
import { FileText } from "lucide-react";
import ChatPanel from "./ChatPanel";
import useReportChat from "../../hooks/useReportChat";
import useAppStore from "../../useAppStore";
import { CITY_TO_STATE } from "../../utils/chartConstants";

const ReportChatWidget = ({
  resultsSelection,
  fuelType,
  emissionType,
  chartMode,
  consumptionChartRef,
  emissionChartRef,
  co2ChartRef,
  ch4ChartRef,
  n2oChartRef,
  cityName: cityNameProp,
  r1r2DataMap,
  r3DataMap,
}) => {
  const [open, setOpen] = useState(false);
  const { messages, loading, reportUrl, sendMessage, clearChat } = useReportChat();

  const classificationState = useAppStore((s) => s.classificationState);
  const derived = useAppStore((s) => s.derived);

  const captureChartImages = () => {
    const images = [];
    const refs = [
      { ref: consumptionChartRef, label: `${fuelType || "Fuel"} Consumption` },
      { ref: emissionChartRef, label: `${emissionType || "Emission"} Emission` },
      { ref: co2ChartRef, label: "CO2 Emission" },
      { ref: ch4ChartRef, label: "CH4 Emission" },
      { ref: n2oChartRef, label: "N2O Emission" },
    ];
    for (const { ref, label } of refs) {
      try {
        const chart = ref?.current?.getChart?.();
        if (chart) {
          // Save original styles, then set all lines to full opacity for the report
          const saved = chart.data.datasets.map((ds) => ({
            borderColor: ds.borderColor,
            borderWidth: ds.borderWidth,
          }));
          chart.data.datasets.forEach((ds) => {
            ds.borderColor = ds._baseColor || ds.borderColor;
            ds.borderWidth = 1.5;
          });
          chart.update("none");

          const b64 = chart.toBase64Image("image/png", 1);
          if (b64) images.push({ label, data: b64 });

          // Restore original styles
          chart.data.datasets.forEach((ds, i) => {
            ds.borderColor = saved[i].borderColor;
            ds.borderWidth = saved[i].borderWidth;
          });
          chart.update("none");
        }
      } catch {
        // skip charts that can't be captured
      }
    }
    return images;
  };

  const buildDataSnapshot = (cityName, state) => {
    const snapshot = {};

    if (resultsSelection === "VEHICLE" && r1r2DataMap && state) {
      // R1/R2 data: keyed by metric, each has labels, unit, tracts (tractId -> values[])
      const fileData = r1r2DataMap[`${state}_${chartMode}`];
      if (fileData) {
        // Include data for selected fuel type and emission type metrics
        const metricsToInclude = [fuelType, emissionType].filter(Boolean);
        for (const metric of metricsToInclude) {
          const metricData = fileData[metric];
          if (!metricData) continue;
          const tractIds = Object.keys(metricData.tracts || {});
          const tractSummaries = {};
          // Cap to first 10 tracts to avoid huge payloads
          const cappedTracts = tractIds.slice(0, 10);
          for (const tractId of cappedTracts) {
            const values = metricData.tracts[tractId];
            if (!Array.isArray(values) || values.length === 0) continue;
            const min = Math.min(...values);
            const max = Math.max(...values);
            const total = values.reduce((a, b) => a + b, 0);
            const mean = total / values.length;
            tractSummaries[tractId] = {
              min: +min.toFixed(4),
              max: +max.toFixed(4),
              mean: +mean.toFixed(4),
              total: +total.toFixed(4),
              values: values.map((v) => +v.toFixed(4)),
            };
          }
          if (tractIds.length > 10) {
            tractSummaries._note = `Showing 10 of ${tractIds.length} tracts`;
          }
          snapshot[metric] = {
            labels: metricData.labels,
            unit: metricData.unit,
            tracts: tractSummaries,
          };
        }
      }
    }

    if (resultsSelection === "GRID" && r3DataMap && state) {
      // R3 data: for each emission type (CO2, CH4, N2O)
      for (const gas of ["CO2", "CH4", "N2O"]) {
        const json = r3DataMap[`${state}_${gas}`];
        if (!json?.scenarios) continue;
        const scenarioSummaries = {};
        for (const [scenarioName, dataPoints] of Object.entries(json.scenarios)) {
          if (!Array.isArray(dataPoints) || dataPoints.length === 0) continue;
          const values = dataPoints.map((p) => p.value);
          const start = values[0];
          const end = values[values.length - 1];
          const min = Math.min(...values);
          const max = Math.max(...values);
          const trend = end < start ? "declining" : end > start ? "increasing" : "stable";
          scenarioSummaries[scenarioName] = {
            start: +start.toFixed(4),
            end: +end.toFixed(4),
            min: +min.toFixed(4),
            max: +max.toFixed(4),
            trend,
            dataPoints: dataPoints.map((p) => ({
              date: p.date.replace(/\s+00:00:00$/, ""),
              value: +p.value.toFixed(4),
            })),
          };
        }
        snapshot[gas] = {
          unit: json.unit || gas,
          scenarios: scenarioSummaries,
        };
      }
    }

    return Object.keys(snapshot).length > 0 ? snapshot : undefined;
  };

  const buildContext = () => {
    const cityName = cityNameProp || classificationState.city || classificationState.cityInput || "";
    const state = CITY_TO_STATE[cityName] || CITY_TO_STATE[cityName?.replace(/\s/g, "")] || "";
    const dataSnapshot = buildDataSnapshot(cityName, state);
    return {
      mode: resultsSelection || "",
      city: cityName,
      state,
      vehicleType: classificationState.vehicleType || "",
      baseYear: classificationState.baseYear || "",
      fuelType: fuelType || "",
      emissionType: emissionType || "",
      chartMode: chartMode || "",
      speedKmh: derived.speedKmh,
      vehicleWeightKg: derived.vehicleWeightKg,
      chartImages: captureChartImages(),
      ...(dataSnapshot && { dataSnapshot }),
    };
  };

  const handleSend = (prompt) => {
    sendMessage(prompt, buildContext());
  };

  return (
    <div className="fixed bottom-6 right-6 z-[9999]">
      {open ? (
        <ChatPanel
          messages={messages}
          loading={loading}
          reportUrl={reportUrl}
          onSend={handleSend}
          onMinimize={() => setOpen(false)}
          onClose={() => { setOpen(false); clearChat(); }}
        />
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-5 py-3 rounded-lg shadow-lg hover:bg-blue-700 hover:shadow-xl transition-all font-semibold text-sm"
          title="Generate Report"
        >
          <FileText size={20} />
          Generate Report
        </button>
      )}
    </div>
  );
};

export default ReportChatWidget;
