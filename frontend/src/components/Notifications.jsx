import React, { useEffect, useRef, useState } from "react";
import { FaBell } from "react-icons/fa";
import useAppStore from "../useAppStore";

function timeAgo(ts) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const Notifications = () => {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const theme = useAppStore((s) => s.theme);
  const isDark = theme === "dark";

  useEffect(() => {
    const onDocClick = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target))
        setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  // Mark notifications as read when dropdown is opened
  useEffect(() => {
    if (open) {
      const markAllNotificationsAsRead = useAppStore.getState().markAllNotificationsAsRead;
      markAllNotificationsAsRead();
    }
  }, [open]);

  const btnTheme = isDark
    ? "bg-[#163e73] text-white border-white/20 hover:bg-[#1b4d8f] focus:ring-white/30"
    : "bg-white text-[#163e73] border-gray-200 hover:bg-[#f3f7ff] focus:ring-blue-500/30";

  const menuTheme = isDark
    ? "bg-zinc-900 text-zinc-100 border-white/10"
    : "bg-white text-gray-900 border-gray-200";

  const itemHover = isDark ? "hover:bg-white/5" : "hover:bg-gray-50";
  const timeTheme = isDark ? "text-zinc-400" : "text-gray-500";

  const notifications = useAppStore((s) => s.notifications);
  const addNotification = (notif) => {
    if (typeof notif === 'string') {
      useAppStore.getState().addNotification(notif);
    } else if (notif && notif.text) {
      useAppStore.getState().addNotification(notif.text);
    }
  };

  const unreadCount = notifications?.filter((n) => !n.read).length || 0;
  const hasUnread = unreadCount > 0;

  // Listen for global notification events (replace toast usage in app with this)
  useEffect(() => {
    const handler = (e) => {
      if (e.detail && e.detail.text) {
        addNotification(e.detail);
      }
    };
    window.addEventListener("app-notification", handler);
    return () => window.removeEventListener("app-notification", handler);
  }, []);

  return (
  <div className="relative w-full" ref={wrapperRef}>
      <button
        type="button"
        className={`text-center rounded-sm flex items-center justify-between border-2 w-full px-2 py-1 transition-colors duration-300 focus:outline-none focus:ring-2 ${btnTheme}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="notifications-menu"
      >
        <span className="flex items-center gap-2">
          <FaBell className="text-lg" />
          Notifications
          {hasUnread && (
            <span className="ml-1 text-xs font-bold text-red-600 animate-bounce">!</span>
          )}
        </span>
        <i className="bi bi-chevron-down" aria-hidden="true"></i>
      </button>

      {open && (
        <div
          id="notifications-menu"
          role="menu"
          className={`absolute left-0 right-0 mt-1 rounded-md border z-50 transition-colors duration-300 ${menuTheme}`}
        >
          {/* Show all notifications, but only 4 visible at a time with scroll */}
          <ul className="max-h-48 overflow-auto py-1">
            {notifications.slice().reverse().map((n) => (
              <li key={n.id} role="menuitem">
                <div
                  className={`px-3 py-2 flex items-start justify-between gap-3 ${itemHover} ${!n.read ? 'bg-blue-50/50 dark:bg-blue-900/20' : ''}`}
                >
                  <span className="text-sm flex items-start gap-2">
                    {!n.read && (
                      <span className="inline-block w-2 h-2 bg-blue-500 rounded-full mt-1 flex-shrink-0"></span>
                    )}
                    {n.text}
                  </span>
                  <time className={`text-xs whitespace-nowrap ${timeTheme}`}>
                    {timeAgo(n.at)}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default Notifications;
