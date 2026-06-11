import { useState } from "react";
import { MessageSquare } from "lucide-react";
import ChatPanel from "./ChatPanel";
import useReportChat from "../../hooks/useReportChat";
import useAppStore from "../../useAppStore";
import { CITY_TO_STATE } from "../../utils/chartConstants";

const ReportChatWidget = ({ resultsSelection, fuelType, emissionType, chartMode }) => {
  const [open, setOpen] = useState(false);
  const { messages, loading, reportUrl, sendMessage, clearChat } = useReportChat();

  const classificationState = useAppStore((s) => s.classificationState);
  const derived = useAppStore((s) => s.derived);

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
          className="w-14 h-14 rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 hover:shadow-xl transition-all flex items-center justify-center"
          title="Generate Report"
        >
          <MessageSquare size={24} />
        </button>
      )}
    </div>
  );
};

export default ReportChatWidget;
