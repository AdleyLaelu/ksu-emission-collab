/**
 * Send a notification to the Notifications inbox dropdown.
 * Dispatches a custom "app-notification" event that Notifications.jsx listens for.
 *
 * Usage: notify("Processing complete") or notify("Upload failed")
 *
 * NOTE: This replaces react-toastify toast calls. The toaster is hidden temporarily
 * per lab request; all notifications go to the inbox dropdown instead.
 * To restore toaster, uncomment <ToastContainer /> in App.jsx and swap back to toast.*.
 */
export function notify(text) {
  window.dispatchEvent(
    new CustomEvent("app-notification", { detail: { text } })
  );
}
