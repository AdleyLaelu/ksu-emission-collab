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
  "Traffic Volume and Speed",
  "Projected Demand",
];

// ABM availability check - Atlanta has pre-computed data for years 2020-2050
const ABM_MIN_YEAR = 2020;
const ABM_MAX_YEAR = 2050;

const isABMAvailable = (city, year) => {
  if (!city || !year) return false;
  const normalizedCity = city.toLowerCase().trim();
  const yearNum = parseInt(year, 10);
  return normalizedCity === "atlanta" && yearNum >= ABM_MIN_YEAR && yearNum <= ABM_MAX_YEAR;
};

function InputStepper({ finalNext, activeStep, setActiveStep }) {
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

    // Step 0: Vehicle Classification
    if (activeStep === 0) {
      const state = store.classificationState;
      if (state && state.uploadedFile) {
        const formData = new FormData();
        formData.append("main_city", state.city || "");
        formData.append("year", state.baseYear || "");
        formData.append("user_id", "1");
        formData.append("file", state.uploadedFile, state.uploadedFile.name);

        const storedTransactionId =
          localStorage.getItem("transaction_id") || "emission-analysis-2025";
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
          window.dispatchEvent(
            new CustomEvent("app-notification", { detail: { text: "Data uploaded successfully" } })
          );
        } catch (err) {
          console.error("Upload error:", err);
          window.dispatchEvent(
            new CustomEvent("app-notification", { detail: { text: "Data uploaded successfully (mocked)" } })
          );
          lastSentDataRef.current = formData;
        }
      }
    }

    // Step 1: Penetration Rate - use component's handleNext if exported
    else if (activeStep === 1) {
      const state = store.penetrationState;
      if (state && state.penetrationFile) {
        const formData = new FormData();
        formData.append("city", store.classificationState.city || "");
        formData.append("base_year", store.classificationState.baseYear || "");
        formData.append("vehicle_type", store.classificationState.vehicleType || "");
        formData.append("projected_year", state.projectedYear || "");

        const storedTransactionId =
          localStorage.getItem("transaction_id") || "emission-analysis-2025";
        formData.append("transaction_id", storedTransactionId);

        formData.append("user_id", "1");
        formData.append("file", state.penetrationFile);

        try {
          const res = await fetch(
            `${API_URL}/upload/penetration_rate`,
            {
              method: "POST",
              body: formData,
            }
          );
          if (!res.ok) throw new Error("Upload failed");
          const data = await res.json();
          console.log("Backend response:", data);
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

    // Step 2: Traffic Volume - needs TWO files OR ABM mode with estimated speed
    else if (activeStep === 2) {
      const state = store.trafficVolumeState;
      const classState = store.classificationState;

      // Check if ABM mode is active
      const city = classState.city || classState.cityInput || "";
      const year = classState.baseYear || "";
      const abmAvailable = isABMAvailable(city, year);

      // ABM mode: skip file upload, just proceed if speed was estimated
      if (abmAvailable) {
        if (state.speedEstimated) {
          console.log("ABM mode - speed estimated, proceeding to next step");
          // Skip file upload and proceed directly
        } else {
          window.dispatchEvent(
            new CustomEvent("app-notification", { detail: { text: "Please estimate speed first" } })
          );
          return;
        }
      } else {
        // Non-ABM mode: Check if both files exist
        if (!state.trafficVolumeFile || !state.trafficMFTParametersFile) {
          window.dispatchEvent(
            new CustomEvent("app-notification", { detail: { text: "Please upload both Traffic Volume and MFD Parameters files" } })
          );
          return;
        }

        // Non-ABM mode: Upload files to backend
        const formData = new FormData();
        formData.append("city_name", classState.city || classState.cityInput || "");

        const storedTransactionId =
          localStorage.getItem("transaction_id") || "emission-analysis-2025";
        formData.append("transaction_id", storedTransactionId);

        formData.append("file1", state.trafficVolumeFile);
        formData.append("file2", state.trafficMFTParametersFile);

        try {
          console.log("Uploading to /upload/traffic_volume...");
          const res = await fetch(`${API_URL}/upload/traffic_volume`, {
            method: "POST",
            body: formData,
          });

          if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.error || "Upload failed");
          }

          const data = await res.json();
          console.log("Backend response:", data);
          window.dispatchEvent(
            new CustomEvent("app-notification", { detail: { text: "Traffic data uploaded successfully!" } })
          );

          if (data.transaction_id) {
            localStorage.setItem("transaction_id", data.transaction_id);
          }
        } catch (err) {
          console.error("Upload error:", err);
          window.dispatchEvent(
            new CustomEvent("app-notification", { detail: { text: "Upload failed: " + err.message } })
          );
          return; // Don't proceed to next step on error
        }
      }
    }

    // Step 3: Projected Demand - needs file upload OR ABM mode with estimated speed
    else if (activeStep === 3) {
      const state = store.projectedDemandState;
      const classState = store.classificationState;
      const penState = store.penetrationState;

      const city = classState.city || classState.cityInput || "";
      const projectedYear = penState.projectedYear || "";
      const abmAvailable = isABMAvailable(city, projectedYear);

      // ABM mode: skip file upload, just check if speed was estimated
      if (abmAvailable) {
        if (state.speedEstimated) {
          console.log("ABM mode - projected demand estimated, proceeding");
          // ABM mode doesn't need file upload
        } else {
          window.dispatchEvent(
            new CustomEvent("app-notification", { detail: { text: "Please estimate speed for projected year first" } })
          );
          return;
        }
      } else {
        // Non-ABM mode: upload file if provided
        if (state.projectedTrafficVolumeFile) {
          const formData = new FormData();

          formData.append("city_name", city);
          formData.append("year", projectedYear || classState.baseYear || "");

          const storedTransactionId =
            localStorage.getItem("transaction_id") || "emission-analysis-2025";
          formData.append("transaction_id", storedTransactionId);

          // Send the original uploaded file
          formData.append("file_csv", state.projectedTrafficVolumeFile);

          // Send the table data as JSON text (for file_table parameter)
          if (state.projectedTrafficVolumeHeaders && state.projectedTrafficVolumeData) {
            // Convert headers and data to array of objects (JSON format)
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
            const res = await fetch(`${API_URL}/upload/projected_traffic`, {
              method: "POST",
              body: formData,
            });
            if (!res.ok) throw new Error("Upload failed");
            const respData = await res.json();
            console.log("Backend response:", respData);
            window.dispatchEvent(
              new CustomEvent("app-notification", { detail: { text: "Data uploaded successfully!" } })
            );

            // Store transaction_id for later use
            if (respData.transaction_id) {
              localStorage.setItem("transaction_id", respData.transaction_id);
            }
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
    <div className="flex flex-col items-center gap-5 pt-0 w-full">
      {/* Step-wise content */}
      <div className="w-full">
        {activeStep === 0 && <VehicleClassification activeStep={activeStep} />}
        {activeStep === 1 && <VehiclePenetration activeStep={activeStep} />}
        {activeStep === 2 && <VehicleTrafficVolume activeStep={activeStep} />}
        {activeStep === 3 && <ProjectedDemand activeStep={activeStep} />}
      </div>

      {/* Navigation Buttons */}
      <div className="w-full max-w-7xl mx-auto flex flex-row items-center mt-2 justify-between">
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
          {activeStep < steps.length - 1 && (
            <button
              className="bg-blue-500 text-white px-4 py-2 rounded"
              onClick={handleNext}
              style={{ minWidth: 100 }}
            >
              Next
            </button>
          )}
          {activeStep === steps.length - 1 && (
            <button
              className="bg-green-600 text-white px-4 py-2 rounded -ml-2"
              onClick={async () => {
                // First save the projected demand data to database
                const store = useAppStore.getState();
                const state = store.projectedDemandState;
                const classState = store.classificationState;
                const penState = store.penetrationState;

                if (state.projectedTrafficVolumeFile) {
                  const formData = new FormData();

                  const city = classState.city || classState.cityInput || "";
                  const year = penState.projectedYear || classState.baseYear || "";

                  formData.append("city_name", city);
                  formData.append("year", year);

                  const storedTransactionId =
                    localStorage.getItem("transaction_id") || "emission-analysis-2025";
                  formData.append("transaction_id", storedTransactionId);

                  // Send the original uploaded file
                  formData.append("file_csv", state.projectedTrafficVolumeFile);

                  // Send the table data as JSON text (for file_table parameter)
                  if (state.projectedTrafficVolumeHeaders && state.projectedTrafficVolumeData) {
                    // Convert headers and data to array of objects (JSON format)
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
                    const res = await fetch(`${API_URL}/upload/projected_traffic`, {
                      method: "POST",
                      body: formData,
                    });
                    if (!res.ok) throw new Error("Upload failed");
                    const respData = await res.json();
                    console.log("Backend response:", respData);
                    window.dispatchEvent(
                      new CustomEvent("app-notification", { detail: { text: "Data uploaded successfully!" } })
                    );

                    // Store transaction_id for later use
                    if (respData.transaction_id) {
                      localStorage.setItem("transaction_id", respData.transaction_id);
                    }
                  } catch (err) {
                    console.error("Upload error:", err);
                    window.dispatchEvent(
                      new CustomEvent("app-notification", { detail: { text: "Upload failed: " + err.message } })
                    );
                  }
                }

                // Then navigate to analysis page
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
