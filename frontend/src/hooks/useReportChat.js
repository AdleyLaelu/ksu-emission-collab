import { useState, useCallback, useRef } from "react";
import { API_URL } from "../config";

export default function useReportChat() {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [reportUrl, setReportUrl] = useState(null);
  const abortRef = useRef(null);

  const sendMessage = useCallback(async (prompt, context) => {
    if (!prompt.trim() || loading) return;

    const userMsg = { role: "user", content: prompt };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    // Build conversation history for the API (only user/assistant messages)
    const conversation = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map(({ role, content }) => ({ role, content }));

    try {
      abortRef.current = new AbortController();
      const res = await fetch(`${API_URL}/api/report/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, context, conversation }),
        signal: abortRef.current.signal,
      });

      const data = await res.json();
      const aiMsg = { role: "assistant", content: data.content || "No response." };
      setMessages((prev) => [...prev, aiMsg]);

      if (data.type === "report" && data.downloadUrl) {
        setReportUrl(`${API_URL}${data.downloadUrl}`);
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Failed to reach the server. Please try again." },
        ]);
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }, [messages, loading]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setReportUrl(null);
  }, []);

  return { messages, loading, reportUrl, sendMessage, clearChat };
}
