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

// ABM Configuration
const ABM_AVAILABLE_YEARS = [2020, 2030, 2033, 2040, 2050];
const ABM_MIN_YEAR = 2020;
const ABM_MAX_YEAR = 2050;

const isABMAvailable = (city, year) => {
  if (!city || !year) return false;
  const normalizedCity = city.toLowerCase().trim();
  const yearNum = parseInt(year, 10);
  return normalizedCity === "atlanta" && yearNum >= ABM_MIN_YEAR && yearNum <= ABM_MAX_YEAR;
};

const isExactABMYear = (year) => ABM_AVAILABLE_YEARS.includes(parseInt(year, 10));

function VehicleTrafficVolume() {
  const classificationState = useAppStore((s) => s.classificationState);
  const trafficState = useAppStore((s) => s.trafficVolumeState);
  const setTrafficState = useAppStore((s) => s.setTrafficVolumeState);
  const trafficMode = useAppStore((s) => s.trafficMode);
  const trafficModeLocked = useAppStore((s) => s.trafficModeLocked);
  const setTrafficMode = useAppStore((s) => s.setTrafficMode);
  const addNotification = useAppStore.getState().addNotification;

  // Shared hover/pin state for map <-> chart linking
  const [hoveredTract, setHoveredTract] = useState(null);
  const [pinnedTract, setPinnedTract] = useState(null);
  const activeTract = hoveredTract || pinnedTract;

  const handleTractHover = useCallback((tractId) => setHoveredTract(tractId), []);
  const handleTractClick = useCallback((tractId) => {
    setPinnedTract((prev) => (prev === tractId ? null : tractId));
  }, []);

  const showResults = trafficState.showResults || false;
  const trafficChartData = trafficState.trafficChartData || null;

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
    if (trafficState.speedEstimated && (trafficState.trafficVolumeFile || trafficState.trafficMFTParametersData?.length > 0 || trafficMode === "ABM")) {
      setTrafficState({ showResults: true });
    }
  }, [trafficState.speedEstimated, trafficState.trafficVolumeFile, trafficState.trafficMFTParametersData, trafficMode, setTrafficState]);

  const city = (classificationState.city ?? classificationState.cityInput) || "";
  const year = classificationState.baseYear || "";

  // ABM is only possible for Atlanta 2020-2050
  const abmPossible = isABMAvailable(city, year);

  // Auto-select ABM if possible and no mode chosen yet
  useEffect(() => {
    if (!trafficMode && abmPossible) {
      setTrafficMode("ABM");
    } else if (!trafficMode && !abmPossible && city && year) {
      setTrafficMode("MFD");
    }
  }, [trafficMode, abmPossible, city, year, setTrafficMode]);

  const hasTrafficVolumeFile = trafficState.trafficVolumeFile;
  const hasMFTParametersData = trafficState.trafficMFTParametersData?.length > 0;

  const handleModeSwitch = (newMode) => {
    if (trafficModeLocked) return;
    setTrafficMode(newMode);
    // Clear results when switching modes
    setTrafficState({
      showResults: false,
      speedEstimated: false,
      methodUsed: null,
      trafficChartData: null,
    });
  };

  // --- ABM: Process and fetch chart data ---
  const handleABMProcess = async () => {
    if (!city || !year) return;
    const exactYear = isExactABMYear(year);
    const method = exactYear ? "ABM Direct" : "ABM Interpolated";

    setTrafficState({ showResults: true, speedEstimated: true, methodUsed: method });

    try {
      toast.info(`Using Activity-Based Model for ${city} ${year}`, { autoClose: 2000 });
      const abmRes = await fetch(`${API_URL}/process/traffic/abm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city_name: city, year: parseInt(year, 10), method: "auto" }),
      });
      if (!abmRes.ok) {
        const errData = await abmRes.json();
        throw new Error(errData.message || errData.error || "ABM processing failed");
      }
      const abmData = await abmRes.json();
      toast.success(`ABM processed ${abmData.tracts_processed} tracts (${abmData.method_used})`, { autoClose: 3000 });

      const url = `${API_URL}/plot/traffic/data/${encodeURIComponent(city)}/${encodeURIComponent(year)}?source=abm`;
      const res = await fetch(url);
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || "Failed to fetch traffic chart data");
      }
      const chartJson = await res.json();
      setTrafficState({ trafficChartData: chartJson });
    } catch (err) {
      console.error("ABM processing error:", err);
      setTrafficState({ trafficChartData: null });
      toast.error(err.message || "Failed to process traffic data");
      addNotification(err.message || "Failed to load traffic data");
    }
  };

  // --- MFD: Load uploaded file ---
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
        updates = { trafficVolumeFile: file };
      } else if (type === "mftParameters") {
        updates = {
          trafficMFTParametersHeaders: parsed.length ? parsed[0] : [],
          trafficMFTParametersData: parsed.length ? parsed.slice(1) : [],
          trafficMFTParametersFile: file,
        };
      }
      setTrafficState(updates);

      // MFD processing: when parameters file is uploaded and traffic volume file exists, process and show chart
      if (type === "mftParameters" && parsed.length && city && year) {
        try {
          const formData = new FormData();
          formData.append("city_name", city);
          formData.append("year", year);
          formData.append("parameters_file", file);

          toast.info("Processing MFD traffic data...", { autoClose: 2000 });
          const processRes = await fetch(`${API_URL}/process/traffic`, { method: "POST", body: formData });
          if (processRes.ok) {
            // Fetch chart data
            const chartUrl = `${API_URL}/plot/traffic/data/${encodeURIComponent(city)}/${encodeURIComponent(year)}?source=mfd`;
            const chartRes = await fetch(chartUrl);
            if (chartRes.ok) {
              const chartJson = await chartRes.json();
              setTrafficState({
                showResults: true,
                speedEstimated: true,
                methodUsed: "MFD",
                trafficChartData: chartJson,
              });
              toast.success("MFD processing complete", { autoClose: 2000 });
            }
          }
        } catch (err) {
          console.error("MFD processing failed", err);
          toast.error("MFD processing failed: " + err.message);
        }
      }
    };
    file.name.endsWith(".csv") ? reader.readAsText(file) : reader.readAsBinaryString(file);
  };

  const statesList = ["", "Atlanta", "Los Angeles", "Seattle", "NewYork"];

  return (
    <div className="flex flex-col pt-4 w-full max-w-full items-center">
      <div className="w-full max-w-7xl mx-auto flex flex-col gap-4">

        {/* === Mode Toggle === */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-600 mr-2">Method:</span>
          <button
            type="button"
            disabled={trafficModeLocked || !abmPossible}
            onClick={() => handleModeSwitch("ABM")}
            className={`px-4 py-1.5 rounded-l-lg text-sm font-semibold border transition-colors
              ${trafficMode === "ABM"
                ? "bg-green-600 text-white border-green-600"
                : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}
              ${(trafficModeLocked || !abmPossible) ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
          >
            <span className="flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" />
              ABM (Activity-Based Model)
            </span>
          </button>
          <button
            type="button"
            disabled={trafficModeLocked}
            onClick={() => handleModeSwitch("MFD")}
            className={`px-4 py-1.5 rounded-r-lg text-sm font-semibold border border-l-0 transition-colors
              ${trafficMode === "MFD"
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}
              ${trafficModeLocked ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
          >
            <span className="flex items-center gap-1.5">
              <FileSpreadsheet className="w-3.5 h-3.5" />
              MFD (Macroscopic Fundamental Diagram)
            </span>
          </button>
          {trafficModeLocked && (
            <span className="text-xs text-gray-400 ml-2 italic">Locked for this session</span>
          )}
          {!abmPossible && trafficMode === "MFD" && (
            <span className="text-xs text-gray-400 ml-2 italic">ABM only available for Atlanta (2020-2050)</span>
          )}
        </div>

        {/* === ABM Mode UI === */}
        {trafficMode === "ABM" && (
          <div className="flex flex-col gap-4">
            <form className="flex flex-row flex-nowrap items-end gap-2 p-2 rounded w-full min-w-0">
              <button
                type="button"
                className="flex items-center bg-blue-500 hover:bg-blue-600 text-white font-semibold px-4 rounded h-10 whitespace-nowrap gap-2"
                onClick={handleABMProcess}
              >
                Average Daily Traffic Speed and Volume Data
                <CloudUpload className="w-5 h-5" />
              </button>
              <div className="flex flex-col gap-1 items-center">
                <label className="text-xs font-medium text-gray-600">Base Year</label>
                <select
                  value={year}
                  disabled
                  className="bg-gray-200 text-gray-600 rounded px-2 h-10 w-24 border border-gray-300 font-semibold text-base"
                >
                  <option value="">Year</option>
                  {year && <option value={year}>{year}</option>}
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
                    <option key={st} value={st}>{st}</option>
                  ))}
                </select>
              </div>
            </form>
          </div>
        )}

        {/* === MFD Mode UI === */}
        {trafficMode === "MFD" && (
          <div className="flex flex-col gap-4">
            <form className="flex flex-row flex-nowrap items-end gap-3 p-2 rounded w-full min-w-0">
              {/* File 1: Traffic Volume */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-600">Traffic Volume Data</label>
                <label className="flex items-center bg-blue-500 hover:bg-blue-600 text-white font-semibold px-4 rounded cursor-pointer h-10 whitespace-nowrap gap-2 text-sm">
                  {hasTrafficVolumeFile ? trafficState.trafficVolumeFile.name : "Upload Traffic Volume"}
                  <CloudUpload className="w-4 h-4" />
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => loadSheet(e.target.files[0], "trafficVolume")}
                    className="hidden"
                  />
                </label>
              </div>

              {/* File 2: MFD Parameters */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-600">MFD Parameters</label>
                <label className="flex items-center bg-blue-500 hover:bg-blue-600 text-white font-semibold px-4 rounded cursor-pointer h-10 whitespace-nowrap gap-2 text-sm">
                  {hasMFTParametersData ? trafficState.trafficMFTParametersFile?.name || "Uploaded" : "Upload MFD Parameters"}
                  <CloudUpload className="w-4 h-4" />
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => loadSheet(e.target.files[0], "mftParameters")}
                    className="hidden"
                  />
                </label>
              </div>

              <div className="flex flex-col gap-1 items-center">
                <label className="text-xs font-medium text-gray-600">Base Year</label>
                <select
                  value={year}
                  disabled
                  className="bg-gray-200 text-gray-600 rounded px-2 h-10 w-24 border border-gray-300 font-semibold text-base"
                >
                  <option value="">Year</option>
                  {year && <option value={year}>{year}</option>}
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
                    <option key={st} value={st}>{st}</option>
                  ))}
                </select>
              </div>
            </form>

            {/* Upload status */}
            <div className="flex items-center gap-4 px-2 text-sm">
              <span className={hasTrafficVolumeFile ? "text-green-600" : "text-gray-400"}>
                {hasTrafficVolumeFile ? "\u2713 Traffic Volume" : "\u25CB Traffic Volume"}
              </span>
              <span className={hasMFTParametersData ? "text-green-600" : "text-gray-400"}>
                {hasMFTParametersData ? "\u2713 MFD Parameters" : "\u25CB MFD Parameters"}
              </span>
            </div>
          </div>
        )}

        {/* === No mode selected yet === */}
        {!trafficMode && (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm border border-dashed border-gray-300 rounded-lg">
            Select a city and base year in Step 1 to begin
          </div>
        )}

        {/* --- Results Section: Interactive Chart --- */}
        {showResults && trafficState.speedEstimated && trafficChartData && (
          <div className="flex flex-col gap-2 w-full max-w-7xl mt-4">
            {trafficState.methodUsed && (
              <div className={`flex items-center gap-2 px-3 py-1 rounded text-sm font-medium w-fit ${
                trafficState.methodUsed.includes("ABM")
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-blue-50 text-blue-700 border border-blue-200"
              }`}>
                {trafficState.methodUsed.includes("ABM") ? <Zap className="w-3 h-3" /> : <FileSpreadsheet className="w-3 h-3" />}
                <span>Method: {trafficState.methodUsed}</span>
              </div>
            )}

            <div className="flex flex-row gap-6 items-start">
              <div className="flex-1 min-w-0">
                <TrafficChart
                  tractData={trafficChartData.tracts}
                  dataSource={trafficChartData.dataSource}
                  city={trafficChartData.city}
                  year={trafficChartData.year}
                  activeTract={activeTract}
                  onTractHover={handleTractHover}
                />
              </div>
              {classificationState.city && (
                <div className="flex flex-col gap-2 w-72 shrink-0">
                  <InteractiveTractMap
                    city={classificationState.city}
                    tractColors={tractColors}
                    activeTract={activeTract}
                    pinnedTract={pinnedTract}
                    onTractHover={handleTractHover}
                    onTractClick={handleTractClick}
                  />
                  {pinnedTract && (
                    <div className="flex items-center justify-between px-3 py-1.5 bg-blue-50 border border-blue-200 rounded text-xs">
                      <span className="text-blue-700 font-medium">
                        Pinned: {pinnedTract.length > 6 ? pinnedTract.slice(-6) : pinnedTract}
                      </span>
                      <button type="button" className="text-blue-500 hover:text-blue-700 font-medium" onClick={() => setPinnedTract(null)}>
                        Clear
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* MFD Parameters Table */}
            {trafficMode === "MFD" && hasMFTParametersData && (
              <div style={{ margin: 0, padding: 0, textAlign: "center", marginTop: "32px" }}>
                <div className="bg-[#f7f7f9] text-[#222222] text-center box-border font-semibold border border-solid border-[#cccccc] rounded-none">
                  <span>Macroscopic Traffic Model Parameters</span>
                </div>
                <div style={{ display: "inline-block", width: "100%" }}>
                  <TractParametersTable trafficState={trafficState} alignLeft />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Export handleNext for parent component
VehicleTrafficVolume.handleNext = function (classificationState, trafficState) {
  return (async () => {
    const mode = useAppStore.getState().trafficMode;
    const city = (classificationState.city ?? classificationState.cityInput) || "";
    const year = classificationState.baseYear || "";

    if (mode === "ABM") {
      console.log("ABM mode: skipping file upload");
      return;
    }

    // MFD mode: upload both files
    const trafficVolumeFile = trafficState.trafficVolumeFile || null;
    const mftParametersFile = trafficState.trafficMFTParametersFile || null;

    if (!trafficVolumeFile || !mftParametersFile) {
      toast.error("Please upload both Traffic Volume and MFD Parameters files");
      return;
    }

    const formData = new FormData();
    formData.append("city_name", city);
    formData.append("base_year", year);
    formData.append("vehicle_type", classificationState.vehicleType || "");
    formData.append("transaction_id", localStorage.getItem("transaction_id") || "emission-analysis-2025");
    formData.append("file1", trafficVolumeFile);
    formData.append("file2", mftParametersFile);

    try {
      const res = await fetch(`${API_URL}/upload/traffic_volume`, { method: "POST", body: formData });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "Upload failed");
      }
      const data = await res.json();
      if (data.transaction_id) localStorage.setItem("transaction_id", data.transaction_id);
      toast.success("Traffic data uploaded successfully!");
    } catch (err) {
      console.error("Upload error:", err);
      toast.error("Upload failed: " + err.message);
    }
  })();
};

export default VehicleTrafficVolume;
