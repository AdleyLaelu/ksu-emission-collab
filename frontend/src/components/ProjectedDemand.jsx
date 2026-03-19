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

// eslint-disable-next-line no-unused-vars
const isExactABMYear = (year) => ABM_AVAILABLE_YEARS.includes(parseInt(year, 10));

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
  const setPenetrationState = useAppStore((s) => s.setPenetrationState);
  const projectedDemandState = useAppStore((s) => s.projectedDemandState);
  const setProjectedDemandState = useAppStore((s) => s.setProjectedDemandState);
  const trafficState = useAppStore((s) => s.trafficVolumeState);

  // Use the locked traffic mode from store (set in Step 2)
  const trafficMode = useAppStore((s) => s.trafficMode);
  const isABM = trafficMode === "ABM";
  const isMFD = trafficMode === "MFD";

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

  const currentYear = penetrationState.projectedYear || "";
  const isDataStale = trafficChartData && chartYear && chartYear !== currentYear;

  // File Upload Logic (MFD mode)
  const loadSheet = (file, keyHeaders, keyData) => {
    if (!file) return;
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
          [keyHeaders]: parsed[0],
          [keyData]: parsed.slice(1),
          projectedTrafficVolumeFile: file,
        });
      } else {
        setProjectedDemandState({
          [keyHeaders]: [],
          [keyData]: [],
          projectedTrafficVolumeFile: null,
        });
      }
    };
    file.name.endsWith(".csv") ? reader.readAsText(file) : reader.readAsBinaryString(file);
  };

  const cityToFile = {
    Atlanta: "GA", "Los Angeles": "CA", Seattle: "WA", NewYork: "NY",
    "New York": "Newyork", LosAngeles: "California", Georgia: "Georgia",
    California: "California", Washington: "Washington",
  };

  const statesList = ["", "Atlanta", "Los Angeles", "Seattle", "NewYork"];

  const cityNameMapping = {
    LosAngeles: "Los Angeles", "Los Angeles": "Los Angeles",
    NewYork: "NewYork", "New York": "NewYork",
    Atlanta: "Atlanta", Seattle: "Seattle",
  };

  const rawCityName = (classificationState.city || classificationState.cityInput || "").trim();
  const mappedCity = cityNameMapping[rawCityName] || rawCityName;
  const year = penetrationState.projectedYear || classificationState.baseYear || "";

  // ABM availability for the projected year
  // eslint-disable-next-line no-unused-vars
  const abmAvailableForYear = isABMAvailable(mappedCity, year);

  // For non-ABM mode, use static images
  let projectedImg = null;
  if (isMFD && mappedCity && year) {
    const fileCity = cityToFile[mappedCity] || mappedCity;
    projectedImg = `/projected-demand-images/${fileCity}_${year}.png`;
  }

  const hasChartData = trafficChartData && !isDataStale;

  // ABM mode: upload handler for projected year
  const handleABMProjectedUpload = async (file, selectedYear) => {
    if (!file || !selectedYear || !mappedCity) return;

    setTrafficChartData(null);
    setChartYear(null);
    setIsLoading(true);
    setShowTable(true);

    try {
      toast.info("Processing ABM data for projected year...", { autoClose: 2000 });
      const formData = new FormData();
      formData.append("file", file);
      formData.append("city_name", mappedCity);
      formData.append("year", selectedYear);

      const abmRes = await fetch(`${API_URL}/process/traffic/abm/upload`, {
        method: "POST",
        body: formData,
      });
      if (!abmRes.ok) {
        const errData = await abmRes.json();
        throw new Error(errData.message || errData.error || "ABM processing failed");
      }
      const abmData = await abmRes.json();
      setMethodUsed("ABM Upload");
      toast.success(`Processed ${abmData.tracts_processed} tracts`, { autoClose: 2000 });

      const dataUrl = `${API_URL}/plot/traffic/data/${encodeURIComponent(mappedCity)}/${encodeURIComponent(selectedYear)}?source=abm`;
      const dataRes = await fetch(dataUrl);
      if (!dataRes.ok) {
        throw new Error("Failed to fetch chart data");
      }
      const chartJson = await dataRes.json();
      setTrafficChartData(chartJson);
      setChartYear(selectedYear);
      setProjectedDemandState({ speedEstimated: true });
    } catch (err) {
      console.error("ABM projected upload error:", err);
      toast.error(err.message || "Failed to process ABM data");
      setTrafficChartData(null);
    } finally {
      setIsLoading(false);
    }
  };

  // MFD mode: process traffic data and fetch interactive chart when projected year changes
  useEffect(() => {
    if (!isMFD) return;
    const selectedYear = penetrationState.projectedYear;
    if (!selectedYear || !mappedCity) return;
    if (chartYear === selectedYear && trafficChartData) return;

    const mfdParamsFile = trafficState.trafficMFTParametersFile;

    // Clear stale chart data immediately to prevent flashing
    setTrafficChartData(null);
    setChartYear(null);
    setShowTable(true);
    setProjectedDemandState({ speedEstimated: true });
    setMethodUsed("MFD");

    if (!mfdParamsFile) return;

    let cancelled = false;
    const processMFD = async () => {
      setIsLoading(true);
      try {
        const formData = new FormData();
        formData.append("parameters_file", mfdParamsFile);
        formData.append("city_name", mappedCity);
        formData.append("year", selectedYear);

        const processRes = await fetch(`${API_URL}/process/traffic`, {
          method: "POST",
          body: formData,
        });
        if (!processRes.ok) {
          console.error("MFD processing failed for projected year");
          return;
        }
        if (cancelled) return;

        const dataUrl = `${API_URL}/plot/traffic/data/${encodeURIComponent(mappedCity)}/${encodeURIComponent(selectedYear)}?source=mfd`;
        const dataRes = await fetch(dataUrl);
        if (!dataRes.ok) return;
        const chartJson = await dataRes.json();
        if (cancelled) return;
        setTrafficChartData(chartJson);
        setChartYear(selectedYear);
      } catch (err) {
        if (cancelled) return;
        console.error("MFD projected demand processing error:", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    processMFD();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [penetrationState.projectedYear, mappedCity, isMFD]);

  return (
    <div className="flex flex-col pt-4 w-full max-w-full items-center">
      <div className="w-full max-w-7xl mx-auto flex flex-col gap-6">

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
              {isABM ? "ABM (Activity-Based Model)" : "MFD (Macroscopic Fundamental Diagram)"}
              <span className="text-xs opacity-60 ml-1">locked from Step 2</span>
            </span>
          </div>
        </div>

        <form className="flex items-end gap-4 p-2 rounded flex-wrap">
          {/* Step 1: Pick projected year first */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Projected Year</label>
            <select
              value={penetrationState.projectedYear || ""}
              onChange={(e) => {
                setPenetrationState({ projectedYear: e.target.value });
                setProjectedDemandState({ speedEstimated: false, abmProjectedFile: null });
                setTrafficChartData(null);
                setChartYear(null);
              }}
              className="border rounded px-2 py-1 w-28 h-10"
            >
              <option value="">Select Year</option>
              {classificationState.baseYear &&
                Array.from({ length: 30 }, (_, i) => parseInt(classificationState.baseYear) + i + 1).map((yr) => (
                  <option key={yr} value={yr}>{yr}</option>
                ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">City</label>
            <select
              value={mappedCity}
              disabled
              className="bg-gray-200 text-gray-600 rounded px-2 h-10 min-w-[90px] border border-gray-300 font-semibold text-base"
            >
              <option value="">City</option>
              {statesList.slice(1).map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </select>
          </div>

          {/* Step 2: Show upload button only after year is selected */}
          {penetrationState.projectedYear && isABM && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-600">ABM Data for {penetrationState.projectedYear}</label>
              <label className="flex items-center bg-blue-500 hover:bg-blue-600 text-white font-semibold px-4 rounded cursor-pointer h-10 whitespace-nowrap gap-2 text-sm">
                {projectedDemandState.abmProjectedFile
                  ? projectedDemandState.abmProjectedFile.name
                  : `Upload ABM Data (${penetrationState.projectedYear})`}
                <CloudUpload className="w-4 h-4" />
                <input
                  type="file"
                  accept=".csv"
                  onChange={(e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    setProjectedDemandState({ abmProjectedFile: file });
                    handleABMProjectedUpload(file, penetrationState.projectedYear);
                  }}
                  className="hidden"
                />
              </label>
            </div>
          )}

          {penetrationState.projectedYear && isMFD && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-600">Projected Traffic Volume for {penetrationState.projectedYear}</label>
              <label className="flex items-center bg-blue-500 hover:bg-blue-600 text-white font-semibold px-4 rounded cursor-pointer h-10 whitespace-nowrap gap-2 text-sm">
                {projectedDemandState.projectedTrafficVolumeFile
                  ? projectedDemandState.projectedTrafficVolumeFile.name
                  : `Upload Data (${penetrationState.projectedYear})`}
                <CloudUpload className="w-4 h-4" />
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => loadSheet(e.target.files[0], "projectedTrafficVolumeHeaders", "projectedTrafficVolumeData")}
                  className="hidden"
                />
              </label>
            </div>
          )}
        </form>

        {/* Prompt to upload when year is selected but no file yet */}
        {penetrationState.projectedYear && isABM && !projectedDemandState.abmProjectedFile && !isLoading && (
          <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
            Please upload ABM traffic data for year {penetrationState.projectedYear}.{" "}
            <a href="/ABM_template.csv" download className="underline font-medium hover:text-amber-900">Download template</a>
          </div>
        )}
        {penetrationState.projectedYear && isMFD && !projectedDemandState.projectedTrafficVolumeFile && !isLoading && !hasChartData && (
          <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
            Please upload projected traffic volume data for year {penetrationState.projectedYear}.
          </div>
        )}


        {/* Loading indicator */}
        {isLoading && (
          <div className="flex items-center gap-2 px-4 py-2 text-sm text-blue-700">
            <span className="animate-spin inline-block w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full" />
            Loading traffic data for year {penetrationState.projectedYear}...
          </div>
        )}

        {/* --- Results: Interactive Chart (both ABM and MFD when data exists) --- */}
        {hasChartData && (
          <div className="flex flex-col gap-2 w-full max-w-7xl">
            {methodUsed && !isDataStale && (
              <div className={`flex items-center gap-2 px-3 py-1 rounded text-sm font-medium w-fit ${
                methodUsed.includes("ABM")
                  ? "bg-green-50 text-green-700 border border-green-200"
                  : "bg-blue-50 text-blue-700 border border-blue-200"
              }`}>
                {methodUsed.includes("ABM") ? <Zap className="w-3 h-3" /> : <FileSpreadsheet className="w-3 h-3" />}
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
                <div className="flex flex-col gap-2 w-72 shrink-0">
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

        {/* --- MFD Results: Static Image fallback (only when NO interactive chart and NOT loading) --- */}
        {isMFD && !hasChartData && !isLoading && projectedDemandState.speedEstimated && projectedImg && mappedCity && (
          <div className="flex flex-col gap-2 w-full max-w-7xl">
            {methodUsed && (
              <div className="flex items-center gap-2 px-3 py-1 rounded text-sm font-medium w-fit bg-blue-50 text-blue-700 border border-blue-200">
                <FileSpreadsheet className="w-3 h-3" />
                <span>Method: {methodUsed}</span>
              </div>
            )}
            <div className="relative w-full border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm">
              <div className="pt-4 pb-2 text-center">
                <span className="text-lg font-semibold">Year {year}</span>
              </div>
              <div className="w-full h-[360px] overflow-auto">
                <img
                  src={projectedImg}
                  alt={`${mappedCity} ${year} Projected Demand`}
                  className="max-w-none mx-auto"
                  style={{ width: "100%", height: "auto", objectFit: "contain" }}
                />
              </div>
            </div>
          </div>
        )}

        {/* MFD: Uploaded data table */}
        {isMFD && showTable && projectedDemandState.speedEstimated && projectedDemandState.projectedTrafficVolumeData?.length > 0 ? (
          <div className="w-full max-w-7xl bg-[#f7f7f9] text-[#222222] overflow-x-auto">
            <div className="bg-[#f7f7f9] border border-[#ccc] border-b-0 text-center text-lg text-[#222]">
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
                licenseKey="non-commercial-and-evaluation"
                themeName={theme === "dark" ? "ht-theme-main-dark" : "ht-theme-main"}
                afterGetColHeader={(col, TH) => {
                  TH.style.textAlign = "center";
                  TH.style.fontWeight = "bold";
                }}
                cells={() => ({ className: "htCenter" })}
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
              <span>Macroscopic Traffic Model Parameters</span>
            </div>
            <TractParametersTable trafficState={trafficState} alignLeft />
          </div>
        )}
      </div>
    </div>
  );
}

export default ProjectedDemand;
