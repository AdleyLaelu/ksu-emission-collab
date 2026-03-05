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

// Register Handsontable modules
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

function ProjectedDemand() {
  const [showTable, setShowTable] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [methodUsed, setMethodUsed] = useState(null);
  // Interactive chart data (ABM mode)
  const [trafficChartData, setTrafficChartData] = useState(null);
  const [chartYear, setChartYear] = useState(null);
  // Static image fallback (non-ABM mode)
  const [dynamicPlotImg, setDynamicPlotImg] = useState(null);
  const [imageYear, setImageYear] = useState(null);

  // Shared hover/pin state for map ↔ chart linking
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

  // Auto-show table if speed was estimated before
  useEffect(() => {
    if (projectedDemandState.speedEstimated) {
      setShowTable(true);
    }
  }, [projectedDemandState.speedEstimated]);

  // Build tractColors map for the interactive map
  const tractColors = useMemo(() => {
    if (!trafficChartData?.tracts?.length) return {};
    const map = {};
    trafficChartData.tracts.forEach((tract, idx) => {
      map[tract.tractId] = TAB20[idx % TAB20.length];
    });
    return map;
  }, [trafficChartData]);

  // Check if current data is stale (different year than selected)
  const currentYear = penetrationState.projectedYear || "";
  const isDataStale = (trafficChartData && chartYear && chartYear !== currentYear) ||
                      (dynamicPlotImg && imageYear && imageYear !== currentYear);

  // File Upload Logic
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
    "New York": "Newyork", "LosAngeles": "California", Georgia: "Georgia",
    California: "California", Washington: "Washington",
  };

  const statesList = ["", "Atlanta", "Los Angeles", "Seattle", "NewYork"];

  const cityNameMapping = {
    LosAngeles: "Los Angeles", "Los Angeles": "Los Angeles", "los angeles": "Los Angeles", "losangeles": "Los Angeles",
    NewYork: "NewYork", "New York": "NewYork", "new york": "NewYork", "newyork": "NewYork",
    Atlanta: "Atlanta", "atlanta": "Atlanta",
    Seattle: "Seattle", "seattle": "Seattle",
  };

  const rawCityName = (classificationState.city || classificationState.cityInput || "").trim();
  const mappedCity = cityNameMapping[rawCityName] || rawCityName;
  const year = penetrationState.projectedYear || classificationState.baseYear || "";

  // Check if ABM is available for projected year
  const abmAvailable = isABMAvailable(mappedCity, year);
  const exactABMYear = isExactABMYear(year);

  // For non-ABM mode, use static images
  let projectedImg = null;
  if (!abmAvailable && mappedCity && year) {
    const fileCity = cityToFile[mappedCity] || mappedCity;
    projectedImg = `/projected-demand-images/${fileCity}_${year}.png`;
  }

  // Determine if we can estimate speed
  const canEstimateSpeed = abmAvailable
    ? !!year
    : (!!year && projectedDemandState.projectedTrafficVolumeData?.length > 0);

  // Has interactive chart data available?
  const hasChartData = trafficChartData && !isDataStale;

  return (
    <div className="flex flex-col pl-6 pt-4">
      <div className="flex flex-col gap-6">
        {/* Method Indicator Badge */}
        {mappedCity && year && (
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium w-fit ${
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
                <span>Static Mode - Upload Required</span>
              </>
            )}
          </div>
        )}

        <form className="flex items-end gap-4 p-4 rounded">
          {/* Hide upload button when ABM is available - no files needed */}
          {!abmAvailable && (
            <label className="flex items-center bg-blue-400 text-white font-semibold px-4 h-[32px] rounded cursor-pointer whitespace-nowrap gap-2">
              <span>Projected Demand</span>
              <CloudUpload className="w-5 h-5" />
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) =>
                  loadSheet(e.target.files[0], "projectedTrafficVolumeHeaders", "projectedTrafficVolumeData")
                }
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
              className="border rounded px-2 py-1 w-20 h-[32px] bg-gray-200 text-gray-700"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Year</label>
            <select
              value={penetrationState.projectedYear || ""}
              onChange={e => {
                setPenetrationState({ projectedYear: e.target.value });
                setProjectedDemandState({ speedEstimated: false });
              }}
              className="border rounded px-2 py-1 w-24 h-[32px]"
            >
              <option value="">Select</option>
              {classificationState.baseYear &&
                Array.from({ length: 5 }, (_, i) => parseInt(classificationState.baseYear) + i + 1)
                  .map(year => (
                    <option key={year} value={year}>{year}</option>
                  ))}
            </select>
          </div>

          <div className="flex flex-col gap-1 w-full">
            <label className="text-xs font-medium text-gray-600">City</label>
            <div className="flex items-center gap-2">
              <select
                value={mappedCity}
                disabled
                className={`bg-gray-300 text-gray-600 rounded px-2 py-1 w-48 ${
                  theme === "dark" ? "border-gray-700" : "border-white"
                }`}
              >
                <option value="">City</option>
                {statesList.slice(1).map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={`${abmAvailable ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-500 hover:bg-blue-600'} text-white font-semibold px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2`}
                disabled={!canEstimateSpeed || isLoading}
                onClick={async () => {
                  if (!mappedCity || !year) return;

                  setIsLoading(true);
                  setShowTable(true);
                  setProjectedDemandState({ speedEstimated: true });

                  try {
                    if (abmAvailable) {
                      // ABM Mode: process + fetch interactive chart data
                      console.log(`[ABM Projected] Processing ${mappedCity} ${year} using Activity-Based Model`);
                      toast.info(`Using Activity-Based Model for projected year ${year}`, { autoClose: 2000 });

                      const abmRes = await fetch(`${API_URL}/process/traffic/abm`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          city_name: mappedCity,
                          year: parseInt(year, 10),
                          method: "auto"
                        })
                      });

                      if (!abmRes.ok) {
                        const errData = await abmRes.json();
                        throw new Error(errData.message || errData.error || "ABM processing failed");
                      }

                      const abmData = await abmRes.json();
                      console.log("[ABM Projected] Response:", abmData);
                      setMethodUsed(abmData.method_used || (exactABMYear ? "ABM Direct" : "ABM Interpolated"));
                      toast.success(`ABM processed ${abmData.tracts_processed} tracts for year ${year}`, { autoClose: 3000 });

                      // Fetch interactive chart data (JSON)
                      const dataUrl = `${API_URL}/plot/traffic/data/${encodeURIComponent(mappedCity)}/${encodeURIComponent(year)}`;
                      const dataRes = await fetch(dataUrl);
                      if (!dataRes.ok) {
                        const errBody = await dataRes.json().catch(() => ({}));
                        throw new Error(errBody.error || "Failed to fetch traffic chart data");
                      }
                      const chartJson = await dataRes.json();
                      setTrafficChartData(chartJson);
                      setChartYear(year);
                      setDynamicPlotImg(null); // Clear any old static image
                    } else {
                      // Non-ABM mode: static image
                      setMethodUsed("Static");
                      setImageYear(year);
                      setTrafficChartData(null); // No interactive data
                    }
                  } catch (err) {
                    console.error("Projected demand processing error:", err);
                    toast.error(err.message || "Failed to process projected demand");
                    setTrafficChartData(null);
                    setDynamicPlotImg(null);
                  } finally {
                    setIsLoading(false);
                  }
                }}
              >
                {isLoading ? (
                  <span>Processing...</span>
                ) : (
                  <>
                    {abmAvailable && <Zap className="w-4 h-4" />}
                    {isDataStale ? `Update for ${year}` : (abmAvailable ? 'Load Traffic Data' : 'Estimate Speed')}
                  </>
                )}
              </button>
            </div>
          </div>
        </form>

        {/* --- Results Section --- */}
        {/* ABM Mode: Interactive Chart */}
        {hasChartData && (
          <div className="flex flex-col gap-2 w-full max-w-5xl">
            {/* Stale Data Warning */}
            {isDataStale && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-50 text-amber-800 border border-amber-300">
                <span className="font-medium">Data shown is for Year {chartYear}</span>
                <span className="text-amber-600">— Click &quot;Update for {year}&quot; to refresh</span>
              </div>
            )}

            {/* Method Used Badge */}
            {methodUsed && !isDataStale && (
              <div className={`flex items-center gap-2 px-3 py-1 rounded text-sm font-medium w-fit ${
                methodUsed.includes('ABM')
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-blue-50 text-blue-700 border border-blue-200'
              }`}>
                {methodUsed.includes('ABM') ? <Zap className="w-3 h-3" /> : <FileSpreadsheet className="w-3 h-3" />}
                <span>Method: {methodUsed}</span>
              </div>
            )}

            {/* Interactive Chart + Tract Map side by side */}
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
              )}
            </div>
          </div>
        )}

        {/* Non-ABM Mode: Static Image Fallback */}
        {!hasChartData && projectedDemandState.speedEstimated && projectedImg && mappedCity && (
          <div className="flex flex-col gap-2 max-w-[950px]">
            {methodUsed && (
              <div className="flex items-center gap-2 px-3 py-1 rounded text-sm font-medium w-fit bg-blue-50 text-blue-700 border border-blue-200">
                <FileSpreadsheet className="w-3 h-3" />
                <span>Method: {methodUsed}</span>
              </div>
            )}
            <div className="relative w-full border border-gray-200 rounded-lg overflow-hidden bg-white shadow-sm">
              <div className="pt-4 pb-2 text-center">
                <span className="text-lg font-semibold">Year {imageYear || year}</span>
              </div>
              <div className="w-full h-[360px] overflow-auto">
                <img
                  src={projectedImg}
                  alt={`${mappedCity} ${year} Projected Demand`}
                  className="max-w-none mx-auto"
                  style={{ width: '100%', height: 'auto', objectFit: 'contain' }}
                />
              </div>
            </div>
          </div>
        )}

        {/* --- Table (only for non-ABM mode) --- */}
        {!abmAvailable && showTable && projectedDemandState.speedEstimated && projectedDemandState.projectedTrafficVolumeData?.length > 0 ? (
          <div className="bg-[#f7f7f9] text-[#222222]" style={{ width: '950px', margin: '0 auto', overflowX: 'auto', overflowY: 'hidden' }}>
            <div style={{
              width: '950px',
              background: '#f7f7f9',
              border: '1px solid #cccccc',
              borderBottom: 'none',
              textAlign: 'center',
              fontSize: '1.15rem',
              color: '#222',
            }}>
              <span>Projected Increase In Traffic Volumes</span>
            </div>
            <div style={{ width: '950px', overflowX: 'auto', overflowY: 'hidden' }}>
              <HotTable
                className="overflow-auto"
                style={{ width: '950px', minHeight: 500, borderRadius: 0 }}
                data={projectedDemandState.projectedTrafficVolumeData}
                colHeaders={projectedDemandState.projectedTrafficVolumeHeaders}
                rowHeaders
                stretchH="all"
                licenseKey="non-commercial-and-evaluation"
                themeName={theme === "dark" ? "ht-theme-main-dark" : "ht-theme-main"}
                pagination={false}
                renderPagination={false}
                afterGetColHeader={(col, TH) => {
                  TH.style.textAlign = 'left';
                  TH.style.paddingLeft = '5px';
                  TH.style.fontWeight = 'bold';
                }}
              />
            </div>
          </div>
        ) : !abmAvailable && showTable && projectedDemandState.speedEstimated ? (
          <div className="min-w-[60%] flex items-center justify-center h-[500px] text-gray-500">
            No data available - please upload projected demand file
          </div>
        ) : null}

        {/* Tract Parameters Table */}
        <div style={{ maxWidth: '950px', overflowX: 'auto', overflowY: 'hidden', textAlign:'center', marginTop:'32px'}}>
          <div className="bg-[#f7f7f9] text-[#222222] text-center box-border font-semibold border border-solid border-[#cccccc] rounded-none" style={{borderRadius:0}}>
            <span>Macroscopic Traffic Model Parameters</span>
          </div>
          <div style={{display:'inline-block', width:'100%'}}>
            <TractParametersTable trafficState={trafficState} alignLeft />
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProjectedDemand;
