import React, { useState, useEffect, useMemo, useCallback } from "react";
import { CloudUpload, Zap, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";
import { HotTable } from "@handsontable/react";
import { registerAllModules } from "handsontable/registry";
import useAppStore from "../useAppStore";
import { API_URL } from "../config";
import "handsontable/dist/handsontable.full.min.css";
import "handsontable/styles/handsontable.css";
import "handsontable/styles/ht-theme-main.css";
import "handsontable/styles/ht-theme-horizon.css";
import TractParametersTable from "./TractParametersTable";
import { notify } from "../utils/notify";
import TrafficChart, { TAB20 } from "./TrafficChart";
import InteractiveTractMap from "./InteractiveTractMap";

registerAllModules();

function ProjectedDemand() {
  const [showTable, setShowTable] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [methodUsed, setMethodUsed] = useState(null);
  const [trafficChartData, setTrafficChartData] = useState(null);
  const [chartYear, setChartYear] = useState(null);

  // Shared hover/pin state for map <-> chart linking
  const [hoveredTract, setHoveredTract] = useState(null);
  const [pinnedTract, setPinnedTract] = useState(null);
  const activeTract = hoveredTract || pinnedTract;

  const handleTractHover = useCallback((tractId) => setHoveredTract(tractId), []);
  const handleTractClick = useCallback((tractId) => {
    setPinnedTract((prev) => (prev === tractId ? null : tractId));
  }, []);

  const theme = useAppStore((s) => s.theme);
  const classificationState = useAppStore((s) => s.classificationState);
  const penetrationState = useAppStore((s) => s.penetrationState);
  const projectedDemandState = useAppStore((s) => s.projectedDemandState);
  const setProjectedDemandState = useAppStore((s) => s.setProjectedDemandState);
  const trafficState = useAppStore((s) => s.trafficVolumeState);

  // Use the locked traffic mode from store (set in Step 2)
  const trafficMode = useAppStore((s) => s.trafficMode);
  const isABM = trafficMode === "ABM";
  const isMFD = trafficMode === "MFD";

  const fileInputRef = React.useRef();

  // Per-year uploads tracking
  const yearUploads = projectedDemandState.yearUploads || {};
  const selectedYear = projectedDemandState.selectedYear || null;

  // Generate year list from baseYear+1 to endYear
  const baseYear = parseInt(classificationState.baseYear, 10);
  const endYear = parseInt(penetrationState.projectedYear, 10);
  const yearList = useMemo(() => {
    if (!baseYear || !endYear || endYear <= baseYear) return [];
    return Array.from({ length: endYear - baseYear }, (_, i) => baseYear + i + 1);
  }, [baseYear, endYear]);

  useEffect(() => {
    if (projectedDemandState.speedEstimated) setShowTable(true);
  }, [projectedDemandState.speedEstimated]);

  const tractColors = useMemo(() => {
    if (!trafficChartData?.tracts?.length) return {};
    const map = {};
    trafficChartData.tracts.forEach((tract, idx) => {
      map[tract.tractId] = TAB20[idx % TAB20.length];
    });
    return map;
  }, [trafficChartData]);

  const isDataStale = trafficChartData && chartYear && chartYear !== String(selectedYear);

  const cityNameMapping = {
    LosAngeles: "Los Angeles", "Los Angeles": "Los Angeles",
    NewYork: "NewYork", "New York": "NewYork",
    Atlanta: "Atlanta", Seattle: "Seattle",
  };

  const rawCityName = (classificationState.city || classificationState.cityInput || "").trim();
  const mappedCity = cityNameMapping[rawCityName] || rawCityName;

  const hasChartData = trafficChartData && !isDataStale;
  const yearCache = projectedDemandState.yearCache || {};

  // Restore from cache when selected year changes
  useEffect(() => {
    if (!selectedYear) return;
    const cached = yearCache[selectedYear];
    if (cached) {
      setTrafficChartData(cached.chartData);
      setChartYear(String(selectedYear));
      setMethodUsed(cached.methodUsed);
      setShowTable(true);
      setProjectedDemandState({
        speedEstimated: true,
        abmProjectedFile: cached.file,
      });
    } else {
      // Clear previous year's data when switching to an uncached year
      setTrafficChartData(null);
      setChartYear(null);
      setShowTable(false);
      setProjectedDemandState({
        speedEstimated: false,
        abmProjectedFile: null,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear]);

  // Save to cache helper
  const saveToCache = (yr, file, chartData, method) => {
    setProjectedDemandState({
      yearCache: {
        ...useAppStore.getState().projectedDemandState.yearCache,
        [yr]: { file, chartData, methodUsed: method },
      },
    });
  };

  // ABM mode: upload handler for selected year
  const handleABMProjectedUpload = async (file, yr) => {
    if (!file || !yr || !mappedCity) return;

    setTrafficChartData(null);
    setChartYear(null);
    setIsLoading(true);
    setShowTable(true);

    try {
      notify("Processing ABM data for projected year...");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("city_name", mappedCity);
      formData.append("year", yr);

      const abmRes = await fetch(`${API_URL}/process/traffic/abm/upload`, {
        method: "POST",
        body: formData,
      });
      if (!abmRes.ok) {
        const errData = await abmRes.json();
        throw new Error(errData.message || errData.error || "ABM processing failed");
      }
      const abmData = await abmRes.json();
      setMethodUsed("Import Traffic Data");
      notify(`Processed ${abmData.tracts_processed} tracts`);

      const dataUrl = `${API_URL}/plot/traffic/data/${encodeURIComponent(mappedCity)}/${encodeURIComponent(yr)}?source=abm`;
      const dataRes = await fetch(dataUrl);
      if (!dataRes.ok) throw new Error("Failed to fetch chart data");
      const chartJson = await dataRes.json();

      setTrafficChartData(chartJson);
      setChartYear(String(yr));
      setProjectedDemandState({ speedEstimated: true });
      saveToCache(yr, file, chartJson, "Import Traffic Data");

      // Track in yearUploads
      setProjectedDemandState({
        yearUploads: {
          ...useAppStore.getState().projectedDemandState.yearUploads,
          [yr]: { file, chartData: chartJson, methodUsed: "Import Traffic Data" },
        },
      });
    } catch (err) {
      console.error("ABM projected upload error:", err);
      notify(err.message || "Failed to process ABM data");
      setTrafficChartData(null);
    } finally {
      setIsLoading(false);
    }
  };

  // File Upload Logic (MFD mode)
  const loadSheet = (file, yr) => {
    if (!file || !yr) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target.result;
      const wb = file.name.endsWith(".csv")
        ? XLSX.read(data, { type: "string" })
        : XLSX.read(data, { type: "binary" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const parsed = XLSX.utils.sheet_to_json(ws, { header: 1 });

      if (parsed.length) {
        setProjectedDemandState({
          projectedTrafficVolumeHeaders: parsed[0],
          projectedTrafficVolumeData: parsed.slice(1),
          projectedTrafficVolumeFile: file,
          yearUploads: {
            ...useAppStore.getState().projectedDemandState.yearUploads,
            [yr]: { file, headers: parsed[0], data: parsed.slice(1) },
          },
        });
        // Trigger MFD processing
        processMFDForYear(file, yr);
      } else {
        setProjectedDemandState({
          projectedTrafficVolumeHeaders: [],
          projectedTrafficVolumeData: [],
          projectedTrafficVolumeFile: null,
        });
      }
    };
    file.name.endsWith(".csv") ? reader.readAsText(file) : reader.readAsBinaryString(file);
  };

  // MFD mode: process traffic data for a specific year
  const processMFDForYear = async (volumeFile, yr) => {
    if (!yr || !mappedCity) return;

    const mfdParamsFile = trafficState.trafficMFTParametersFile;
    if (!mfdParamsFile || !volumeFile) return;

    setTrafficChartData(null);
    setChartYear(null);
    setShowTable(true);
    setProjectedDemandState({ speedEstimated: true });
    setMethodUsed("Model Traffic Dynamics");
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append("parameters_file", mfdParamsFile);
      formData.append("traffic_volume_file", volumeFile);
      formData.append("city_name", mappedCity);
      formData.append("year", yr);

      const processRes = await fetch(`${API_URL}/process/traffic`, {
        method: "POST",
        body: formData,
      });
      if (!processRes.ok) {
        const errData = await processRes.json().catch(() => ({}));
        console.error("MFD processing failed for projected year:", errData);
        notify("Processing failed: " + (errData.error || errData.message || "Unknown error"));
        return;
      }

      const dataUrl = `${API_URL}/plot/traffic/data/${encodeURIComponent(mappedCity)}/${encodeURIComponent(yr)}?source=mfd`;
      const dataRes = await fetch(dataUrl);
      if (!dataRes.ok) return;
      const chartJson = await dataRes.json();
      setTrafficChartData(chartJson);
      setChartYear(String(yr));
      saveToCache(yr, mfdParamsFile, chartJson, "Model Traffic Dynamics");
    } catch (err) {
      console.error("MFD projected demand processing error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle file upload for ABM or MFD based on selected year
  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file || !selectedYear) return;

    if (isABM) {
      setProjectedDemandState({ abmProjectedFile: file });
      handleABMProjectedUpload(file, selectedYear);
    } else if (isMFD) {
      loadSheet(file, selectedYear);
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // When selected year changes for MFD, load cached data
  useEffect(() => {
    if (!isMFD || !selectedYear) return;
    const upload = yearUploads[selectedYear];
    if (upload?.headers) {
      setProjectedDemandState({
        projectedTrafficVolumeHeaders: upload.headers,
        projectedTrafficVolumeData: upload.data,
        projectedTrafficVolumeFile: upload.file,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear, isMFD]);

  return (
    <div className="flex flex-col pt-4 w-full">
      <div className="mb-4 pb-3 border-b border-gray-200">
        <h2 className={`text-2xl font-bold tracking-tight ${theme === "dark" ? "text-white" : "text-gray-800"}`}>Projected Demand Data</h2>
        <p className={`text-sm mt-1 ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}>Upload projected traffic demand data for each year from base year to end year.</p>
      </div>
      <div className="w-full flex flex-col gap-6">

        {/* Mode indicator (read-only, locked from Step 2) */}
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-600 mr-2">Method:</span>
          <div className={`px-4 py-1.5 rounded-lg text-sm font-semibold border ${
            isABM
              ? "bg-green-50 text-green-700 border-green-200"
              : "bg-blue-50 text-blue-700 border-blue-200"
          }`}>
            <span className="flex items-center gap-1.5">
              {isABM ? <Zap className="w-3.5 h-3.5" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
              {isABM ? "Import Traffic Data" : "Model Traffic Dynamics"}
              <span className="text-xs opacity-60 ml-1">locked from Step 2</span>
            </span>
          </div>
        </div>

        {/* Base Year + End Year + City row (all disabled/gray) */}
        <div className="flex flex-row gap-4 items-end">
          {/* Base Year — disabled */}
          <div className="flex flex-col gap-1 min-w-[80px] max-w-[100px]">
            <label className="text-xs font-medium text-gray-600">Base Year</label>
            <select
              value={classificationState.baseYear || ""}
              disabled
              className={`bg-gray-300 text-gray-600 rounded px-2 py-1 w-full h-[32px] ${
                theme === "dark" ? "border-gray-700" : "border-white"
              }`}
            >
              <option>{classificationState.baseYear || "Base Year"}</option>
            </select>
          </div>
          {/* End Year — disabled */}
          <div className="flex flex-col gap-1 min-w-[80px] max-w-[100px]">
            <label className="text-xs font-medium text-gray-600">End Year</label>
            <select
              value={penetrationState.projectedYear || ""}
              disabled
              className={`bg-gray-300 text-gray-600 rounded px-2 py-1 w-full h-[32px] ${
                theme === "dark" ? "border-gray-700" : "border-white"
              }`}
            >
              <option>{penetrationState.projectedYear || "End Year"}</option>
            </select>
          </div>
          {/* City — disabled */}
          <div className="flex flex-col gap-1 min-w-[120px] max-w-[180px]">
            <label className="text-xs font-medium text-gray-600">City</label>
            <select
              disabled
              className={`bg-gray-300 text-gray-600 rounded px-2 py-1 w-full h-[32px] ${
                theme === "dark" ? "border-gray-700" : "border-white"
              }`}
            >
              <option>{classificationState.city || "City"}</option>
            </select>
          </div>
        </div>

        {/* Year list box + Upload button */}
        {yearList.length > 0 && (
          <>
            {/* Year list box */}
            <div className={`border rounded-lg overflow-hidden ${theme === "dark" ? "border-gray-700" : "border-gray-300"}`} style={{ maxWidth: 420 }}>
              <div className="overflow-y-auto" style={{ maxHeight: 180 }}>
                {yearList.map((year) => {
                  const isUploaded = !!yearUploads[year];
                  const isSelected = selectedYear === year;
                  return (
                    <div
                      key={year}
                      onClick={() => setProjectedDemandState({ selectedYear: year })}
                      className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer border-b last:border-b-0 transition-colors text-sm
                        ${isSelected
                          ? (theme === "dark" ? "bg-blue-900/40 border-blue-700" : "bg-blue-50 border-blue-200")
                          : (theme === "dark" ? "border-gray-700 hover:bg-gray-800" : "border-gray-100 hover:bg-gray-50")
                        }`}
                    >
                      <span className={`text-base ${isUploaded ? "text-green-600 font-bold" : "text-gray-400"}`}>
                        {isUploaded ? "\u2713" : "\u25CB"}
                      </span>
                      <span className={`font-medium ${
                        isUploaded
                          ? (theme === "dark" ? "text-green-400" : "text-green-700")
                          : (theme === "dark" ? "text-gray-300" : "text-gray-600")
                      }`}>
                        {year} Projected Demand Data
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Upload button */}
            <div className="flex w-full justify-end">
              <label
                className={`flex items-center font-bold px-5 py-2.5 rounded-lg text-sm transition-all duration-200 whitespace-nowrap shadow-md
                  ${!selectedYear ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]"}
                  ${theme === "dark"
                    ? "bg-blue-600 hover:bg-blue-500 text-white"
                    : "bg-blue-700 hover:bg-blue-800 text-white"
                  }`}
              >
                <span className="flex items-center gap-2 justify-center">
                  Upload Data
                  <CloudUpload className="w-4 h-4" />
                  {selectedYear && <span className="font-normal ml-1">({selectedYear})</span>}
                </span>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept={isABM ? ".csv" : ".xlsx,.xls,.csv"}
                  onChange={handleFileUpload}
                  disabled={!selectedYear}
                  className="hidden"
                />
              </label>
            </div>
          </>
        )}

        {/* Prompt to upload when year is selected but no file yet */}
        {selectedYear && !yearUploads[selectedYear] && !isLoading && !hasChartData && (
          <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
            Please upload traffic data for year {selectedYear}.
            {isABM && (
              <>
                {" "}
                <a href="/ABM_template.csv" download className="underline font-medium hover:text-amber-900">Download template</a>
              </>
            )}
          </div>
        )}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex items-center gap-2 px-4 py-2 text-sm text-blue-700">
            <span className="animate-spin inline-block w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full" />
            Loading traffic data for year {selectedYear}...
          </div>
        )}

        {/* --- Results: Interactive Chart (both ABM and MFD when data exists) --- */}
        {hasChartData && (
          <div className="flex flex-col gap-2 w-full max-w-7xl">
            {methodUsed && !isDataStale && (
              <div className={`flex items-center gap-2 px-3 py-1 rounded text-sm font-medium w-fit ${
                methodUsed.includes("Import")
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-blue-50 text-blue-700 border border-blue-200"
              }`}>
                {methodUsed.includes("Import") ? <Zap className="w-3 h-3" /> : <FileSpreadsheet className="w-3 h-3" />}
                <span>Method: {methodUsed}</span>
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
              {mappedCity && (
                <div className="flex flex-col gap-2 w-64 shrink-0">
                  <InteractiveTractMap
                    city={mappedCity}
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
          </div>
        )}

        {/* MFD: Uploaded data table */}
        {isMFD && showTable && projectedDemandState.speedEstimated && projectedDemandState.projectedTrafficVolumeData?.length > 0 ? (
          <div className="w-full max-w-7xl bg-[#f7f7f9] text-[#222222] overflow-x-auto border border-[#ccc]">
            <div className="bg-[#f7f7f9] border-b border-[#ccc] text-center text-lg text-[#222] py-1">
              <span>Projected Increase In Traffic Volumes</span>
            </div>
            <div className="overflow-x-auto">
              <HotTable
                className="overflow-auto"
                style={{ minHeight: 400 }}
                data={projectedDemandState.projectedTrafficVolumeData}
                colHeaders={projectedDemandState.projectedTrafficVolumeHeaders}
                rowHeaders
                stretchH="all"
                colWidths={projectedDemandState.projectedTrafficVolumeHeaders?.map(
                  () => Math.floor(100 / (projectedDemandState.projectedTrafficVolumeHeaders?.length || 1)) + "%"
                )}
                licenseKey="non-commercial-and-evaluation"
                themeName={theme === "dark" ? "ht-theme-main-dark" : "ht-theme-main"}
                afterGetColHeader={(col, TH) => {
                  TH.style.textAlign = "center";
                  TH.style.fontWeight = "bold";
                }}
                cells={(_row, col) => {
                  const headers = projectedDemandState.projectedTrafficVolumeHeaders || [];
                  const isVolumeCol = headers[col]?.toLowerCase().includes("volume");
                  return {
                    className: "htCenter",
                    type: isVolumeCol ? "numeric" : "text",
                    numericFormat: isVolumeCol ? { pattern: "0.00" } : undefined,
                  };
                }}
              />
            </div>
          </div>
        ) : isMFD && showTable && projectedDemandState.speedEstimated ? (
          <div className="w-full max-w-7xl flex items-center justify-center h-32 text-gray-500 text-sm border border-dashed border-gray-300 rounded-lg">
            No data available. Please upload a projected demand file.
          </div>
        ) : null}

        {/* MFD: Tract Parameters Table */}
        {isMFD && (
          <div className="w-full max-w-7xl overflow-x-auto mt-4">
            <div className="bg-[#f7f7f9] text-[#222222] text-center font-semibold border border-[#cccccc]">
              <span>Traffic Model Parameters</span>
            </div>
            <TractParametersTable trafficState={trafficState} />
          </div>
        )}
      </div>
    </div>
  );
}

export default ProjectedDemand;
