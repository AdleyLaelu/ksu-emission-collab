import React, { useRef } from "react";
import useAppStore from "../useAppStore";
import { API_URL } from "../config";
import VehicleClassification from "./VehicleClassification";
import VehiclePenetration from "./VehiclePenetration";
import VehicleTrafficVolume from "./VehicleTrafficVolume";
import ProjectedDemand from "./ProjectedDemand";

const steps = [
  "Vehicle Classification Data",
  "Projected Vehicle Penetration Rate Data",
  "Traffic Volume and Speed Data",
  "Projected Demand Data",
];

// Mode is now read from useAppStore.trafficMode ("ABM" | "MFD" | null)

function InputStepper({ finalNext, activeStep, setActiveStep }) {
  const classificationState = useAppStore((s) => s.classificationState);
  const lastSentDataRef = useRef(null);
  const VEHICLE_TYPES = [
    "Combination long-haul Truck",
    "Combination short-haul Truck",
    "Light Commercial Truck",
    "Motorhome - Recreational Vehicle",
    "Motorcycle",
    "Other Buses",
    "Passenger Car",
    "Passenger Truck",
    "Refuse Truck",
    "School Bus",
    "Single Unit long-haul Truck",
    "Single Unit short-haul Truck",
    "Transit Bus",
  ];

  const handleNext = async () => {
    const store = useAppStore.getState();

    // Step 0: Vehicle Classification — upload base year + all VR years
    if (activeStep === 0) {
      const state = store.classificationState;
      const storedTransactionId =
        localStorage.getItem("transaction_id") || "emission-analysis-2025";

      // Upload base year file
      if (state && state.uploadedFile) {
        const formData = new FormData();
        formData.append("city_name", state.city || "");
        formData.append("year", state.baseYear || "");
        formData.append("user_id", "1");
        formData.append("file", state.uploadedFile, state.uploadedFile.name);
        formData.append("transaction_id", storedTransactionId);

        try {
          const res = await fetch(
            `${API_URL}/upload/vehicle_classification`,
            {
              method: "POST",
              body: formData,
            }
          );
          if (!res.ok) throw new Error("Failed to save table");
          const data = await res.json();
          console.log("Table saved:", data);
          if (data.transaction_id && data.transaction_id !== "none") {
            localStorage.setItem("transaction_id", data.transaction_id);
            console.log("Transaction ID stored:", data.transaction_id);
          }
          lastSentDataRef.current = formData;
        } catch (err) {
          console.error("Upload error (base year):", err);
        }
      }

      // Upload additional VR year files
      const vrYearUploads = state.vrYearUploads || {};
      for (const [year, entry] of Object.entries(vrYearUploads)) {
        if (!entry.file) continue;
        const formData = new FormData();
        formData.append("city_name", state.city || "");
        formData.append("year", year);
        formData.append("user_id", "1");
        formData.append("file", entry.file, entry.file.name);
        formData.append("transaction_id", storedTransactionId);

        try {
          const res = await fetch(
            `${API_URL}/upload/vehicle_classification`,
            { method: "POST", body: formData }
          );
          if (!res.ok) throw new Error(`Failed to upload VR year ${year}`);
          const data = await res.json();
          console.log(`VR year ${year} saved:`, data);
        } catch (err) {
          console.error(`Upload error (VR year ${year}):`, err);
        }
      }

      window.dispatchEvent(
        new CustomEvent("app-notification", { detail: { text: "Data uploaded successfully" } })
      );
    }

    // Step 1: Projected Vehicle Penetration — upload ALL year files as VR data
    else if (activeStep === 1) {
      const state = store.penetrationState;
      const storedTransactionId =
        localStorage.getItem("transaction_id") || "emission-analysis-2025";
      const yearUploads = state.yearUploads || {};
      let uploadCount = 0;

      for (const [year, entry] of Object.entries(yearUploads)) {
        if (!entry.file) continue;
        const formData = new FormData();
        formData.append("city_name", store.classificationState.city || "");
        formData.append("year", year);
        formData.append("user_id", "1");
        formData.append("file", entry.file, entry.file.name);
        formData.append("transaction_id", storedTransactionId);

        try {
          const res = await fetch(
            `${API_URL}/upload/vehicle_classification`,
            { method: "POST", body: formData }
          );
          if (!res.ok) throw new Error(`Failed to upload VR year ${year}`);
          const data = await res.json();
          console.log(`VR year ${year} saved:`, data);
          uploadCount++;
        } catch (err) {
          console.error(`Upload error (VR year ${year}):`, err);
        }
      }

      if (uploadCount > 0) {
        window.dispatchEvent(
          new CustomEvent("app-notification", { detail: { text: `${uploadCount} projected year(s) uploaded successfully!` } })
        );
      }
    }

    // Step 2: Traffic Volume - uses trafficMode from store
    else if (activeStep === 2) {
      const state = store.trafficVolumeState;
      const classState = store.classificationState;
      const mode = store.trafficMode;

      if (mode === "ABM") {
        if (state.speedEstimated) {
          console.log("ABM mode - speed estimated, proceeding to next step");
        } else {
          window.dispatchEvent(
            new CustomEvent("app-notification", { detail: { text: "Traffic data not yet processed. You can continue, but results may be incomplete." } })
          );
        }
      } else if (mode === "MFD") {
        if (state.trafficVolumeFile && state.trafficMFTParametersFile) {
          const formData = new FormData();
          formData.append("city_name", classState.city || classState.cityInput || "");
          formData.append("transaction_id", localStorage.getItem("transaction_id") || "emission-analysis-2025");
          formData.append("file1", state.trafficVolumeFile);
          formData.append("file2", state.trafficMFTParametersFile);

          try {
            const res = await fetch(`${API_URL}/upload/traffic_volume`, { method: "POST", body: formData });
            if (!res.ok) {
              const errorData = await res.json();
              throw new Error(errorData.error || "Upload failed");
            }
            const data = await res.json();
            if (data.transaction_id) localStorage.setItem("transaction_id", data.transaction_id);
            window.dispatchEvent(
              new CustomEvent("app-notification", { detail: { text: "Traffic data uploaded successfully!" } })
            );
          } catch (err) {
            console.error("Upload error:", err);
            window.dispatchEvent(
              new CustomEvent("app-notification", { detail: { text: "Upload failed: " + err.message } })
            );
            return;
          }
        } else {
          window.dispatchEvent(
            new CustomEvent("app-notification", { detail: { text: "Model data files not uploaded. You can continue, but results may be incomplete." } })
          );
        }
      } else {
        window.dispatchEvent(
          new CustomEvent("app-notification", { detail: { text: "No traffic method selected. You can continue, but results may be incomplete." } })
        );
      }
    }

    // Step 3: Projected Demand - uses trafficMode from store
    else if (activeStep === 3) {
      const state = store.projectedDemandState;
      const classState = store.classificationState;
      const penState = store.penetrationState;
      const mode = store.trafficMode;

      const city = classState.city || classState.cityInput || "";
      const projectedYear = penState.projectedYear || "";

      if (mode === "ABM") {
        if (state.speedEstimated) {
          console.log("ABM mode - projected demand estimated, proceeding");
        } else {
          window.dispatchEvent(
            new CustomEvent("app-notification", { detail: { text: "Please select a projected year to load traffic data" } })
          );
          return;
        }
      } else {
        // MFD mode: upload file if provided
        if (state.projectedTrafficVolumeFile) {
          const formData = new FormData();
          formData.append("city_name", city);
          formData.append("year", projectedYear || classState.baseYear || "");
          formData.append("transaction_id", localStorage.getItem("transaction_id") || "emission-analysis-2025");
          formData.append("file_csv", state.projectedTrafficVolumeFile);

          if (state.projectedTrafficVolumeHeaders && state.projectedTrafficVolumeData) {
            const headers = state.projectedTrafficVolumeHeaders;
            const rows = state.projectedTrafficVolumeData;
            const tableData = rows.map(row => {
              const obj = {};
              headers.forEach((header, index) => {
                obj[header] = row[index];
              });
              return obj;
            });
            formData.append("file_table", JSON.stringify(tableData));
          }

          try {
            const res = await fetch(`${API_URL}/upload/projected_traffic`, { method: "POST", body: formData });
            if (!res.ok) throw new Error("Upload failed");
            const respData = await res.json();
            if (respData.transaction_id) localStorage.setItem("transaction_id", respData.transaction_id);
            window.dispatchEvent(
              new CustomEvent("app-notification", { detail: { text: "Data uploaded successfully!" } })
            );
          } catch (err) {
            console.error("Upload error:", err);
            window.dispatchEvent(
              new CustomEvent("app-notification", { detail: { text: "Upload failed: " + err.message } })
            );
          }
        }
      }
    }

    // Step navigation
    if (activeStep < steps.length - 1) {
      setActiveStep((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (activeStep > 0) {
      setActiveStep((prev) => prev - 1);
    }
  };

  return (
    <div className="flex flex-col gap-5 pt-0 w-full">
      {/* Step-wise content */}
      <div className="w-full">
        {activeStep === 0 && <VehicleClassification activeStep={activeStep} />}
        {activeStep === 1 && <VehiclePenetration activeStep={activeStep} />}
        {activeStep === 2 && <VehicleTrafficVolume activeStep={activeStep} />}
        {activeStep === 3 && <ProjectedDemand activeStep={activeStep} />}
      </div>

      {/* Navigation Buttons */}
      <div className="w-full flex flex-row items-center mt-2 justify-between">
        {activeStep > 0 ? (
          <button
            className="bg-blue-500 text-white px-4 py-2 rounded"
            onClick={handleBack}
            style={{ minWidth: 100 }}
          >
            Back
          </button>
        ) : (
          <div style={{ minWidth: 100 }} />
        )}
        <div className="flex flex-row gap-4">
          {activeStep < steps.length - 1 && (() => {
            const isStep0Disabled =
              activeStep === 0 &&
              (!classificationState.baseYear || classificationState.classificationData.length === 0);
            return (
              <button
                className={`text-white px-4 py-2 rounded ${isStep0Disabled ? "bg-gray-300 cursor-not-allowed" : "bg-blue-500"}`}
                onClick={handleNext}
                disabled={isStep0Disabled}
                style={{ minWidth: 100 }}
              >
                Next
              </button>
            );
          })()}
          {activeStep === steps.length - 1 && (
            <button
              className="bg-green-600 text-white px-4 py-2 rounded -ml-2"
              onClick={async () => {
                // Save projected demand data (MFD mode only)
                const store = useAppStore.getState();
                const mode = store.trafficMode;

                if (mode === "MFD") {
                  const state = store.projectedDemandState;
                  const classState = store.classificationState;
                  const penState = store.penetrationState;

                  if (state.projectedTrafficVolumeFile) {
                    const formData = new FormData();
                    formData.append("city_name", classState.city || classState.cityInput || "");
                    formData.append("year", penState.projectedYear || classState.baseYear || "");
                    formData.append("transaction_id", localStorage.getItem("transaction_id") || "emission-analysis-2025");
                    formData.append("file_csv", state.projectedTrafficVolumeFile);

                    if (state.projectedTrafficVolumeHeaders && state.projectedTrafficVolumeData) {
                      const headers = state.projectedTrafficVolumeHeaders;
                      const rows = state.projectedTrafficVolumeData;
                      const tableData = rows.map(row => {
                        const obj = {};
                        headers.forEach((header, index) => { obj[header] = row[index]; });
                        return obj;
                      });
                      formData.append("file_table", JSON.stringify(tableData));
                    }

                    try {
                      const res = await fetch(`${API_URL}/upload/projected_traffic`, { method: "POST", body: formData });
                      if (!res.ok) throw new Error("Upload failed");
                      const respData = await res.json();
                      if (respData.transaction_id) localStorage.setItem("transaction_id", respData.transaction_id);
                    } catch (err) {
                      console.error("Upload error:", err);
                    }
                  }
                }

                // Navigate to analysis page
                finalNext();
              }}
              style={{ minWidth: 140 }}
            >
              Go to Analysis
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default InputStepper;
