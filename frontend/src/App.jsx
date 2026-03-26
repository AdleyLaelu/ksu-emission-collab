import { BrowserRouter, Routes, Route } from "react-router-dom";
// NOTE: Toaster hidden per lab request. All notifications go to the inbox dropdown.
// To restore, uncomment the ToastContainer below and its imports.
// import { ToastContainer } from "react-toastify";
// import "react-toastify/dist/ReactToastify.css";
import { useEffect } from "react";
// import SignIn from "./components/SignIn";
// import SignUp from "./components/SignUp";
import ArrowStepper from "./components/ArrowStepper";
import Header from "./components/Header";
import Footer from "./components/Footer";
import useAppStore from "./useAppStore";
import { API_URL } from "./config";

const App = () => {
  const theme = useAppStore((s) => s.theme);

  // Clear database on application start
  useEffect(() => {
    const clearDatabaseOnStart = async () => {
      try {
        console.log("[App] Clearing database on application start...");
        const response = await fetch(`${API_URL}/admin/clear_db`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (response.ok) {
          const result = await response.json();
          console.log("[App] Database cleared successfully:", result);
        } else {
          console.warn("[App] Failed to clear database:", response.status);
        }
      } catch (error) {
        console.error("[App] Error clearing database on start:", error);
      }
    };

    clearDatabaseOnStart();
  }, []); // Empty dependency array means this runs once on mount

  return (
    // App.tsx
    <BrowserRouter>
      <div className={theme === "dark" ? "dark" : ""}>
        {/* Fixed Header */}
        <div
          className="fixed top-0 left-0 right-0 h-[110px] box-border z-[1000]
                    bg-white/80 dark:bg-gray-900/80 backdrop-blur
                    border-b border-gray-200 dark:border-gray-800"
        >
          <Header />
        </div>

        {/* Content — pad to avoid overlap */}
        <main className="pt-[110px] pb-[72px]">
          <Routes>
            <Route path="/" element={<ArrowStepper />} />
            {/* <Route path="/signin" element={<SignIn />} /> */}
            {/* <Route path="/signup" element={<SignUp />} /> */}
          </Routes>
        </main>

        {/* Fixed Footer */}
        <div
          className="fixed bottom-0 left-0 right-0 max-h-[160px] box-border z-[1000]
                    bg-white/80 dark:bg-gray-900/80 backdrop-blur
                    border-t border-gray-200 dark:border-gray-800"
        >
          <Footer />
        </div>
        {/* <ToastContainer /> — hidden per lab request, notifications go to inbox dropdown */}
      </div>
    </BrowserRouter>
  );
};

export default App;
