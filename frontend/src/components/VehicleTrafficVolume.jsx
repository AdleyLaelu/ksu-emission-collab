import React, { useState, useEffect, useMemo, useCallback } from "react";
import { CloudUpload, Zap, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";
import { registerAllModules } from "handsontable/registry";
import useAppStore from "../useAppStore";
import { API_URL } from "../config";
import "handsontable/dist/handsontable.full.min.css";
import "handsontable/styles/handsontable.css";
import "handsontable/styles/ht-theme-main.css";
import "handsontable/styles/ht-theme-horizon.css";
import TractParametersTable from "./TractParametersTable";
import { toast } from "react-toastify";
import TrafficChart, { TAB20 } from "./TrafficChart";
import InteractiveTractMap from "./InteractiveTractMap";

registerAllModules();

// ABM Configuration - years for which Activity-Based Model data is available
const ABM_AVAILABLE_YEARS = [2020, 2030, 2033, 2040, 2050];
const ABM_MIN_YEAR = 2020;
const ABM_MAX_YEAR = 2050;

// Check if ABM data is available for city/year
const isABMAvailable = (city, year) => {
  if (!city || !year) return false;
  const normalizedCity = city.toLowerCase().trim();
  const yearNum = parseInt(year, 10);
  return normalizedCity === "atlanta" && yearNum >= ABM_MIN_YEAR && yearNum <= ABM_MAX_YEAR;
};

// Check if it's an exact ABM year (not interpolated)
const isExactABMYear = (year) => {
  return ABM_AVAILABLE_YEARS.includes(parseInt(year, 10));
};

function VehicleTrafficVolume() {
  const classificationState = useAppStore((s) => s.classificationState);
  const trafficState = useAppStore((s) => s.trafficVolumeState);
  const setTrafficState = useAppStore((s) => s.setTrafficVolumeState);
  const addNotification = useAppStore.getState().addNotification;

  // Shared hover/pin state for map ↔ chart linking
  const [hoveredTract, setHoveredTract] = useState(null);
  const [pinnedTract, setPinnedTract] = useState(null);
  const activeTract = hoveredTract || pinnedTract;

  const handleTractHover = useCallback((tractId) => setHoveredTract(tractId), []);
  const handleTractClick = useCallback((tractId) => {
    setPinnedTract((prev) => (prev === tractId ? null : tractId));
  }, []);

  // Persist showResults and chart data in global state
  const showResults = trafficState.showResults || false;
  const trafficChartData = trafficState.trafficChartData || null;

  // Build tractColors map: { tractId: "#hex" } for the interactive map
  const tractColors = useMemo(() => {
    if (!trafficChartData?.tracts?.length) return {};
    const map = {};
    trafficChartData.tracts.forEach((tract, idx) => {
      map[tract.tractId] = TAB20[idx % TAB20.length];
    });
    return map;
  }, [trafficChartData]);

  // Restore showResults on mount if data exists
  useEffect(() => {
    if (trafficState.speedEstimated && (trafficState.trafficVolumeFile || trafficState.trafficMFTParametersData?.length > 0)) {
      setTrafficState({ showResults: true });
    }
  }, [trafficState.speedEstimated, trafficState.trafficVolumeFile, trafficState.trafficMFTParametersData, setTrafficState]);

  // Submit data to backend - called by parent component during step navigation
  // eslint-disable-next-line no-unused-vars
  const handleNext = async () => {
    const city =
      (classificationState.city ?? classificationState.cityInput) || "";
    const trafficVolumeFile = trafficState.trafficVolumeFile || null;
    const mftParametersFile = trafficState.trafficMFTParametersFile || null;
    const values = {
      city,
      trafficVolumeFile: trafficVolumeFile ? trafficVolumeFile.name : null,
      mftParametersFile: mftParametersFile ? mftParametersFile.name : null,
    };
    console.log("Traffic Volume and Speed upload values (on Next):", values);

    if (!trafficVolumeFile || !mftParametersFile) {
      const msg = "Please select both Traffic Volume and MFT Parameters files";
      addNotification(msg);
      return;
    }

    const formData = new FormData();
    formData.append("city_name", city);
    formData.append("base_year", classificationState.baseYear || "");
    formData.append("vehicle_type", classificationState.vehicleType || "");

    const storedTransactionId =
      localStorage.getItem("transaction_id") || "emission-analysis-2025";
    formData.append("transaction_id", storedTransactionId);

    formData.append("file1", trafficVolumeFile);
    formData.append("file2", mftParametersFile);

    try {
      console.log("Uploading to /upload/traffic_volume...");
      const res = await fetch(`${API_URL}/upload/traffic_volume`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json();
        const msg = errorData.error || "Upload failed";
        addNotification(msg);
        throw new Error(msg);
      }

      const data = await res.json();
      console.log("Backend response:", data);
      toast.success("Traffic data uploaded successfully!");

      if (data.transaction_id) {
        localStorage.setItem("transaction_id", data.transaction_id);
      }
    } catch (err) {
      console.error("Upload error:", err);
      const msg = "Upload failed: " + err.message;
      addNotification(msg);
    }
  };

  const statesList = ["", "Atlanta", "Los Angeles", "Seattle", "NewYork"];

  const loadSheet = (file, type) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const data = e.target.result;
      const wb = file.name.endsWith(".csv")
        ? XLSX.read(data, { type: "string" })
        : XLSX.read(data, { type: "binary" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const parsed = XLSX.utils.sheet_to_json(ws, { header: 1 });

      let updates = {};

      if (type === "trafficVolume") {
        updates = {
          trafficVolumeFile: file,
        };
      } else if (type === "mftParameters") {
        updates = {
          trafficMFTParametersHeaders: parsed.length ? parsed[0] : [],
          trafficMFTParametersData: parsed.length ? parsed.slice(1) : [],
          trafficMFTParametersFile: file,
        };
      }

      setTrafficState(updates);

      if (type === "mftParameters" && parsed.length) {
        try {
          const city = (classificationState.city ?? classificationState.cityInput) || "";
          const year = classificationState.baseYear || "";
          if (city && year) {
            const formData = new FormData();
            formData.append("city_name", city);
            formData.append("year", year);
            formData.append("parameters_file", file);

            await fetch(`${API_URL}/process/traffic`, {
              method: "POST",
              body: formData,
            });
          }
        } catch (err) {
          console.error("MFD background processing failed", err);
        }
      }
    };

    file.name.endsWith(".csv") ? reader.readAsText(file) : reader.readAsBinaryString(file);
  };

  const city = (classificationState.city ?? classificationState.cityInput) || "";

  const hasTrafficVolumeFile = trafficState.trafficVolumeFile;
  const hasMFTParametersData = trafficState.trafficMFTParametersData && trafficState.trafficMFTParametersData.length > 0;

  // Check if ABM is available for current city/year
  const abmAvailable = isABMAvailable(city, classificationState.baseYear);
  const exactABMYear = isExactABMYear(classificationState.baseYear);

  const canEstimateSpeed = abmAvailable || (hasTrafficVolumeFile && hasMFTParametersData);
  const methodToUse = abmAvailable ? (exactABMYear ? "ABM Direct" : "ABM Interpolated") : "MFD";

  return (
    <div className="flex flex-row items-stretch gap-6 pt-4 justify-center w-full max-w-full">
      <div className="flex-1 flex flex-col items-center">
        <div className="w-full max-w-5xl mx-auto flex flex-col gap-6 justify-end items-end">
          {/* Method Indicator Badge */}
          {city && classificationState.baseYear && (
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
              abmAvailable
                ? 'bg-green-100 text-green-800 border border-green-300'
                : 'bg-blue-100 text-blue-800 border border-blue-300'
            }`}>
              {abmAvailable ? (
                <>
                  <Zap className="w-4 h-4" />
                  <span>Activity-Based Model {exactABMYear ? '(Direct)' : '(Interpolated)'}</span>
                </>
              ) : (
                <>
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>MFD Mode - Upload Required</span>
                </>
              )}
            </div>
          )}
          <form className="flex flex-row flex-nowrap items-end gap-2 p-2 rounded w-full min-w-0 mr-16 ml-auto">
          {/* Hide upload buttons when ABM is available - no files needed */}
          {!abmAvailable && (
            <>
              <label className="flex items-center bg-blue-400 text-white font-semibold px-4 rounded cursor-pointer h-10 min-w-[160px] whitespace-nowrap justify-center">
                <span className="mr-2 whitespace-nowrap">Traffic Volume</span>
                <CloudUpload className="ml-2 w-5 h-5" />
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => loadSheet(e.target.files[0], 'trafficVolume')}
                  className="hidden"
                />
              </label>
              <label className="flex items-center bg-blue-400 text-white font-semibold px-4 rounded cursor-pointer h-10 min-w-[160px] whitespace-nowrap justify-center ml-4">
                <span className="mr-2 ml-2 whitespace-nowrap">MFD Parameters</span>
                <CloudUpload className="ml-2 w-5 h-5" />
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => loadSheet(e.target.files[0], 'mftParameters')}
                  className="hidden"
                />
              </label>
            </>
          )}
          <div className="flex flex-col gap-1 items-center">
            <label className="text-xs font-medium text-gray-600">Base Year</label>
            <select
              value={classificationState.baseYear}
              disabled
              className="bg-gray-200 text-gray-600 rounded px-2 h-10 w-24 border border-gray-300 font-semibold text-base"
            >
              <option value="">Base Year</option>
              {classificationState.baseYear && (
                <option value={classificationState.baseYear}>{classificationState.baseYear}</option>
              )}
            </select>
          </div>
          <div className="flex flex-col gap-1 items-center">
            <label className="text-xs font-medium text-gray-600">City</label>
            <select
              value={classificationState.cityInput}
              disabled
              className="bg-gray-200 text-gray-600 rounded px-2 h-10 min-w-[90px] max-w-[120px] border border-gray-300 font-semibold text-base"
            >
              <option value="">City</option>
              {statesList.slice(1).map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className={`${abmAvailable ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-500 hover:bg-blue-600'} text-white font-semibold text-base px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2`}
            style={{ minWidth: 140, maxWidth: 180, height: 40, whiteSpace: 'nowrap' }}
            onClick={async () => {
              const currentCity = (classificationState.city ?? classificationState.cityInput) || "";
              const year = classificationState.baseYear || "";
              if (!currentCity || !year) return;

              setTrafficState({ showResults: true, speedEstimated: true, methodUsed: methodToUse });

              try {
                // If ABM is available for Atlanta, use the ABM endpoint
                if (abmAvailable) {
                  console.log(`[ABM] Processing ${currentCity} ${year} using Activity-Based Model`);
                  toast.info(`Using Activity-Based Model for ${currentCity} ${year}`, { autoClose: 2000 });

                  const abmRes = await fetch(`${API_URL}/process/traffic/abm`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      city_name: currentCity,
                      year: parseInt(year, 10),
                      method: "auto"
                    })
                  });

                  if (!abmRes.ok) {
                    const errData = await abmRes.json();
                    throw new Error(errData.message || errData.error || "ABM processing failed");
                  }

                  const abmData = await abmRes.json();
                  console.log("[ABM] Response:", abmData);
                  toast.success(`ABM processed ${abmData.tracts_processed} tracts (${abmData.method_used})`, { autoClose: 3000 });
                } else {
                  console.log(`[MFD] Processing ${currentCity} ${year} using Macroscopic Fundamental Diagram`);
                }

                // Fetch interactive chart data (JSON) instead of static PNG
                const url = `${API_URL}/plot/traffic/data/${encodeURIComponent(currentCity)}/${encodeURIComponent(year)}`;
                const res = await fetch(url);
                if (!res.ok) {
                  const errBody = await res.json().catch(() => ({}));
                  throw new Error(errBody.error || "Failed to fetch traffic chart data");
                }
                const chartJson = await res.json();
                setTrafficState({ trafficChartData: chartJson });

              } catch (err) {
                console.error("Processing error:", err);
                setTrafficState({ trafficChartData: null });
                toast.error(err.message || "Failed to process traffic data");
                addNotification(err.message || "Failed to load traffic data");
              }
            }}
            disabled={!canEstimateSpeed}
          >
            {abmAvailable && <Zap className="w-4 h-4" />}
            Estimate Speed
          </button>
          </form>
        </div>

        {/* --- Results Section: Interactive Chart --- */}
        {showResults && trafficState.speedEstimated && trafficChartData && (
          <div className="flex flex-col gap-2 w-full max-w-5xl mt-6">
            {/* Method Used Badge */}
            {trafficState.methodUsed && (
              <div className={`flex items-center gap-2 px-3 py-1 rounded text-sm font-medium w-fit ${
                trafficState.methodUsed.includes('ABM')
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-blue-50 text-blue-700 border border-blue-200'
              }`}>
                {trafficState.methodUsed.includes('ABM') ? <Zap className="w-3 h-3" /> : <FileSpreadsheet className="w-3 h-3" />}
                <span>Method: {trafficState.methodUsed}</span>
              </div>
            )}

            {/* Interactive Chart — linked to map via shared hover state */}
            <TrafficChart
              tractData={trafficChartData.tracts}
              dataSource={trafficChartData.dataSource}
              city={trafficChartData.city}
              year={trafficChartData.year}
              activeTract={activeTract}
              onTractHover={handleTractHover}
            />

            {/* MFD Parameters Table */}
            {hasMFTParametersData && (
              <div style={{margin:0,padding:0, textAlign:'center', marginTop:'32px'}}>
                <div className="bg-[#f7f7f9] text-[#222222] text-center box-border font-semibold border border-solid border-[#cccccc] rounded-none" style={{borderRadius:0}}>
                  <span>Macroscopic Traffic Model Parameters</span>
                </div>
                <div style={{display:'inline-block', width:'100%'}}>
                  <TractParametersTable trafficState={trafficState} alignLeft />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right Column: Interactive Tract Map */}
      <div className="flex flex-col gap-6 w-72 shrink-0">
        {classificationState.city && (
          <InteractiveTractMap
            city={classificationState.city}
            tractColors={tractColors}
            activeTract={activeTract}
            pinnedTract={pinnedTract}
            onTractHover={handleTractHover}
            onTractClick={handleTractClick}
          />
        )}
        {/* Pinned tract indicator */}
        {pinnedTract && (
          <div className="flex items-center justify-between px-3 py-1.5 bg-blue-50 border border-blue-200 rounded text-xs">
            <span className="text-blue-700 font-medium">
              Pinned: {pinnedTract.length > 6 ? pinnedTract.slice(-6) : pinnedTract}
            </span>
            <button
              type="button"
              className="text-blue-500 hover:text-blue-700 font-medium"
              onClick={() => setPinnedTract(null)}
            >
              Clear
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Export handleNext for parent component to call when navigating to next step
VehicleTrafficVolume.handleNext = function(classificationState, trafficState) {
  return (async () => {
    const city =
      (classificationState.city ?? classificationState.cityInput) || "";
    const year = classificationState.baseYear || "";
    const trafficVolumeFile = trafficState.trafficVolumeFile || null;
    const mftParametersFile = trafficState.trafficMFTParametersFile || null;

    const abmUsed = isABMAvailable(city, year);

    if (abmUsed) {
      console.log("ABM mode - skipping file upload, proceeding to next step");
      return;
    }

    const values = {
      city,
      trafficVolumeFile: trafficVolumeFile ? trafficVolumeFile.name : null,
      mftParametersFile: mftParametersFile ? mftParametersFile.name : null,
    };
    console.log("Traffic Volume and Speed upload values (on Next):", values);

    if (!trafficVolumeFile || !mftParametersFile) {
      toast.error("Please select both Traffic Volume and MFT Parameters files");
      return;
    }

    const formData = new FormData();
    formData.append("city_name", city);
    formData.append("base_year", year);
    formData.append("vehicle_type", classificationState.vehicleType || "");

    const storedTransactionId =
      localStorage.getItem("transaction_id") || "emission-analysis-2025";
    formData.append("transaction_id", storedTransactionId);

    formData.append("file1", trafficVolumeFile);
    formData.append("file2", mftParametersFile);

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
      toast.success("Traffic data uploaded successfully!");

      if (data.transaction_id) {
        localStorage.setItem("transaction_id", data.transaction_id);
      }
    } catch (err) {
      console.error("Upload error:", err);
      toast.error("Upload failed: " + err.message);
    }
  })();
};

export default VehicleTrafficVolume;
