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
  const abmAvailableForYear = isABMAvailable(mappedCity, year);

  // For non-ABM mode, use static images
  let projectedImg = null;
  if (isMFD && mappedCity && year) {
    const fileCity = cityToFile[mappedCity] || mappedCity;
    projectedImg = `/projected-demand-images/${fileCity}_${year}.png`;
  }

  const hasChartData = trafficChartData && !isDataStale;

  // Auto-load ABM data when projected year changes (only in ABM mode)
  useEffect(() => {
    if (!isABM) return;
    const selectedYear = penetrationState.projectedYear;
    if (!selectedYear || !mappedCity) return;
    if (!isABMAvailable(mappedCity, selectedYear)) return;
    if (trafficChartData && chartYear === selectedYear) return;

    let cancelled = false;
    const loadABMData = async () => {
      setIsLoading(true);
      setShowTable(true);
      setProjectedDemandState({ speedEstimated: true });

      try {
        const abmRes = await fetch(`${API_URL}/process/traffic/abm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ city_name: mappedCity, year: parseInt(selectedYear, 10), method: "auto" }),
        });
        if (!abmRes.ok) {
          const errData = await abmRes.json();
          throw new Error(errData.message || errData.error || "ABM processing failed");
        }
        const abmData = await abmRes.json();
        if (cancelled) return;
        setMethodUsed(abmData.method_used || (isExactABMYear(selectedYear) ? "ABM Direct" : "ABM Interpolated"));

        const dataUrl = `${API_URL}/plot/traffic/data/${encodeURIComponent(mappedCity)}/${encodeURIComponent(selectedYear)}`;
        const dataRes = await fetch(dataUrl);
        if (!dataRes.ok) {
          const errBody = await dataRes.json().catch(() => ({}));
          throw new Error(errBody.error || "Failed to fetch traffic chart data");
        }
        const chartJson = await dataRes.json();
        if (cancelled) return;
        setTrafficChartData(chartJson);
        setChartYear(selectedYear);
      } catch (err) {
        if (cancelled) return;
        console.error("Projected demand auto-load error:", err);
        toast.error(err.message || "Failed to load projected demand data");
        setTrafficChartData(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    loadABMData();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [penetrationState.projectedYear, mappedCity, isABM]);

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

        <form className="flex items-end gap-4 p-2 rounded">
          {/* MFD mode: file upload */}
          {isMFD && (
            <label className="flex items-center bg-blue-500 hover:bg-blue-600 text-white font-semibold px-4 rounded cursor-pointer h-10 whitespace-nowrap gap-2 text-sm">
              {projectedDemandState.projectedTrafficVolumeFile
                ? projectedDemandState.projectedTrafficVolumeFile.name
                : "Upload Projected Traffic Volume"}
              <CloudUpload className="w-5 h-5" />
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => loadSheet(e.target.files[0], "projectedTrafficVolumeHeaders", "projectedTrafficVolumeData")}
                className="hidden"
              />
            </label>
          )}

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Base Year</label>
            <input
              type="text"
              value={classificationState.baseYear || ""}
              readOnly
              className="border rounded px-2 py-1 w-20 h-10 bg-gray-200 text-gray-700"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Projected Year</label>
            <select
              value={penetrationState.projectedYear || ""}
              onChange={(e) => {
                setPenetrationState({ projectedYear: e.target.value });
                setProjectedDemandState({ speedEstimated: false });
              }}
              className="border rounded px-2 py-1 w-24 h-10"
            >
              <option value="">Select</option>
              {classificationState.baseYear &&
                Array.from({ length: 5 }, (_, i) => parseInt(classificationState.baseYear) + i + 1).map((yr) => (
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
        </form>

        {/* ABM: year not in range warning */}
        {isABM && year && !abmAvailableForYear && (
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-50 text-amber-800 border border-amber-300 text-sm">
            ABM data is only available for years 2020-2050. Year {year} is out of range.
          </div>
        )}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex items-center gap-2 px-4 py-2 text-sm text-blue-700">
            <span className="animate-spin inline-block w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full" />
            Loading traffic data for year {penetrationState.projectedYear}...
          </div>
        )}

        {/* --- ABM Results: Interactive Chart --- */}
        {isABM && hasChartData && (
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

        {/* --- MFD Results: Static Image + Table --- */}
        {isMFD && projectedDemandState.speedEstimated && projectedImg && mappedCity && (
          <div className="flex flex-col gap-2 max-w-[950px]">
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

        {/* MFD: Table */}
        {isMFD && showTable && projectedDemandState.speedEstimated && projectedDemandState.projectedTrafficVolumeData?.length > 0 ? (
          <div className="bg-[#f7f7f9] text-[#222222]" style={{ width: "950px", margin: "0 auto", overflowX: "auto" }}>
            <div style={{ width: "950px", background: "#f7f7f9", border: "1px solid #ccc", borderBottom: "none", textAlign: "center", fontSize: "1.15rem", color: "#222" }}>
              <span>Projected Increase In Traffic Volumes</span>
            </div>
            <div style={{ width: "950px", overflowX: "auto" }}>
              <HotTable
                className="overflow-auto"
                style={{ width: "950px", minHeight: 500 }}
                data={projectedDemandState.projectedTrafficVolumeData}
                colHeaders={projectedDemandState.projectedTrafficVolumeHeaders}
                rowHeaders
                stretchH="all"
                licenseKey="non-commercial-and-evaluation"
                themeName={theme === "dark" ? "ht-theme-main-dark" : "ht-theme-main"}
                afterGetColHeader={(col, TH) => {
                  TH.style.textAlign = "left";
                  TH.style.paddingLeft = "5px";
                  TH.style.fontWeight = "bold";
                }}
              />
            </div>
          </div>
        ) : isMFD && showTable && projectedDemandState.speedEstimated ? (
          <div className="min-w-[60%] flex items-center justify-center h-[500px] text-gray-500">
            No data available. Please upload a projected demand file.
          </div>
        ) : null}

        {/* MFD: Tract Parameters Table */}
        {isMFD && (
          <div style={{ maxWidth: "950px", overflowX: "auto", textAlign: "center", marginTop: "32px" }}>
            <div className="bg-[#f7f7f9] text-[#222222] text-center box-border font-semibold border border-solid border-[#cccccc]">
              <span>Macroscopic Traffic Model Parameters</span>
            </div>
            <div style={{ display: "inline-block", width: "100%" }}>
              <TractParametersTable trafficState={trafficState} alignLeft />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ProjectedDemand;
