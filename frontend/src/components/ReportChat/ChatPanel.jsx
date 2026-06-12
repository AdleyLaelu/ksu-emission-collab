import { useState, useRef, useEffect } from "react";
import { X, Minus, Send, Download, Loader2 } from "lucide-react";
import ChatMessage from "./ChatMessage";

const ChatPanel = ({ messages, loading, reportUrl, onSend, onClose, onMinimize }) => {
  const [input, setInput] = useState("");
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    onSend(input.trim());
    setInput("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="w-96 h-[500px] bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-blue-600 text-white rounded-t-xl">
        <span className="font-semibold text-sm">Generate Report</span>
        <div className="flex items-center gap-1">
          <button
            onClick={onMinimize}
            className="p-1 hover:bg-blue-700 rounded transition-colors"
            title="Minimize"
          >
            <Minus size={18} />
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-blue-700 rounded transition-colors"
            title="Close & clear chat"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 text-sm mt-8">
            <p className="mb-2">Please describe the report you would like to generate.</p>
            <p className="text-xs text-gray-300">
              e.g. "Generate a report on CO2 trends for Atlanta"
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessage key={i} role={msg.role} content={msg.content} />
        ))}
        {loading && (
          <div className="flex justify-start mb-2">
            <div className="bg-gray-200 rounded-lg px-3 py-2 rounded-bl-none">
              <Loader2 size={16} className="animate-spin text-gray-500" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Footer */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 px-3 py-2 border-t border-gray-200 bg-gray-50"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Please describe the report you would like to generate."
          disabled={loading}
          className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
        >
          <Send size={16} />
        </button>
        <a
          href={reportUrl || "#"}
          download
          onClick={(e) => { if (!reportUrl) e.preventDefault(); }}
          className={`p-2 rounded-lg transition-colors ${
            reportUrl
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "bg-gray-300 text-gray-400 cursor-not-allowed"
          }`}
          title={reportUrl ? "Download Report PDF" : "No report ready yet"}
        >
          <Download size={16} />
        </a>
      </form>
    </div>
  );
};

export default ChatPanel;
