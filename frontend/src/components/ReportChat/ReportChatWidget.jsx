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

  const buildContext = () => {
    const cityName = classificationState.city || classificationState.cityInput || "";
    const state = CITY_TO_STATE[cityName] || CITY_TO_STATE[cityName?.replace(/\s/g, "")] || "";
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
