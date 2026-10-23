import React from "react";
import { CloudUpload, FileSpreadsheet } from "lucide-react";
import * as XLSX from "xlsx";
import { HotTable } from "@handsontable/react";
import "handsontable/dist/handsontable.full.min.css";
import { registerAllModules } from "handsontable/registry";
import "handsontable/styles/handsontable.css";
import "handsontable/styles/ht-theme-main.css";
import "handsontable/styles/ht-theme-horizon.css";
import { API_URL } from "../config";
import Atlanta from "../assets/Georgia.svg";
import LosAngeles from "../assets/California.svg";
import Seattle from "../assets/Seattle.svg";
import NewYork from "../assets/NewYork.svg";
import VehicleStepper from "./VerticalStepper";
import useAppStore from "../useAppStore";

registerAllModules();

function VehiclePenetration({ activeStep }) {
  const theme = useAppStore((s) => s.theme);
  const classificationState = useAppStore((s) => s.classificationState);
  const penetrationState = useAppStore((s) => s.penetrationState);
  const setPenetrationState = useAppStore((s) => s.setPenetrationState);
  const setClassificationState = useAppStore((s) => s.setClassificationState);

  const cityImages = { "Atlanta": Atlanta, "Los Angeles": LosAngeles, "Seattle": Seattle, "New York": NewYork };
  const verticalSteps = [
    "Vehicle Classification Data",
    "Projected Vehicle Penetration Rate Data",
    "Traffic Volume and Speed Data",
    "Projected Demand Data",
  ];

  const [localVehicleFilter, setLocalVehicleFilter] = React.useState("");
  const [currentPage, setCurrentPage] = React.useState(0);
  const [rowsPerPage, setRowsPerPage] = React.useState(20);
  const fileInputRef = React.useRef();

  // Per-year uploads tracking
  const yearUploads = penetrationState.yearUploads || {};
  const selectedYear = penetrationState.selectedYear || null;

  // Generate year list from baseYear+1 to endYear
  const baseYear = parseInt(classificationState.baseYear, 10);
  const endYear = parseInt(penetrationState.projectedYear, 10);
  const yearList = React.useMemo(() => {
    if (!baseYear || !endYear || endYear <= baseYear) return [];
    return Array.from({ length: endYear - baseYear }, (_, i) => baseYear + i + 1);
  }, [baseYear, endYear]);

  // When a year is selected, load its data into the table
  React.useEffect(() => {
    if (!selectedYear) return;
    const upload = yearUploads[selectedYear];
    if (upload) {
      setPenetrationState({
        penetrationHeaders: upload.headers,
        allPenetrationData: upload.data,
        penetrationFile: upload.file,
      });
    } else {
      setPenetrationState({
        penetrationHeaders: [],
        allPenetrationData: [],
        penetrationData: [],
        penetrationFile: null,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear]);

  // Handle file upload for the selected year
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file || !selectedYear) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = evt.target.result;
      const isCSV = file.name.toLowerCase().endsWith(".csv");
      const workbook = XLSX.read(data, { type: isCSV ? "string" : "binary" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const parsed = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) || [];

      if (parsed.length > 0) {
        const headers = parsed[0];
        const rows = parsed.slice(1);
        const newYearUploads = {
          ...yearUploads,
          [selectedYear]: { file, headers, data: rows },
        };
        setPenetrationState({
          yearUploads: newYearUploads,
          penetrationHeaders: headers,
          allPenetrationData: rows,
          penetrationFile: file,
        });
      } else {
        setPenetrationState({
          penetrationHeaders: [],
          allPenetrationData: [],
          penetrationData: [],
          penetrationFile: null,
        });
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    };

    if (file.name.toLowerCase().endsWith(".csv")) reader.readAsText(file);
    else reader.readAsBinaryString(file);
  };

  // Paginated data
  const paginatedData =
    penetrationState.penetrationData?.slice(
      currentPage * rowsPerPage,
      (currentPage + 1) * rowsPerPage
    ) || [];

  const numericColIndex = React.useMemo(() => {
    const headers = penetrationState.penetrationHeaders || [];
    let idx = headers.findIndex((h) => /vehicle.*count/i.test(String(h || "")));
    if (idx >= 0) return idx;
    idx = headers.findIndex((h) => /^count$/i.test(String(h || "").trim()));
    if (idx >= 0) return idx;
    idx = headers.findIndex((h) => /penetration/i.test(String(h || "")));
    if (idx >= 0) return idx;
    return headers.length > 0 ? headers.length - 1 : -1;
  }, [penetrationState.penetrationHeaders]);

  const displayHeaders = React.useMemo(() => {
    const headers = penetrationState.penetrationHeaders || [];
    if (numericColIndex < 0) return headers;
    return [...headers, "Vehicle %"];
  }, [penetrationState.penetrationHeaders, numericColIndex]);

  const totalNumericValue = React.useMemo(() => {
    if (numericColIndex < 0) return 0;
    return paginatedData.reduce(
      (sum, row) => sum + (parseFloat(row?.[numericColIndex]) || 0), 0
    );
  }, [paginatedData, numericColIndex]);

  const displayData = React.useMemo(() => {
    if (numericColIndex < 0) return paginatedData;
    return paginatedData.map((row) => {
      const val = parseFloat(row?.[numericColIndex]) || 0;
      const pct = totalNumericValue > 0
        ? ((val / totalNumericValue) * 100).toFixed(2)
        : "0.00";
      return [...row, pct];
    });
  }, [paginatedData, numericColIndex, totalNumericValue]);

  const columnConfig = React.useMemo(() => {
    if (numericColIndex < 0) return undefined;
    const headers = penetrationState.penetrationHeaders || [];
    return [
      ...headers.map(() => ({ className: "htCenter" })),
      { readOnly: true, className: "htDimmed htCenter" }
    ];
  }, [penetrationState.penetrationHeaders, numericColIndex]);

  const handleTableChange = React.useCallback((changes, source) => {
    if (!changes || source === "loadData") return;
    const { penetrationState: state, setPenetrationState: setState } =
      useAppStore.getState();
    const filtered = state.penetrationData || [];
    const all = state.allPenetrationData || [];
    const pctCol = (state.penetrationHeaders || []).length;
    let dirty = false;
    const newAll = [...all];
    changes.forEach(([row, col, oldVal, newVal]) => {
      if (col >= pctCol || oldVal === newVal) return;
      const idx = currentPage * rowsPerPage + row;
      const ref = filtered[idx];
      if (!ref) return;
      const allIdx = all.indexOf(ref);
      if (allIdx >= 0) {
        newAll[allIdx] = [...all[allIdx]];
        newAll[allIdx][col] = newVal;
        dirty = true;
      }
    });
    if (dirty) setState({ allPenetrationData: newAll });
  }, [currentPage, rowsPerPage]);

  const totalPages = Math.ceil(
    (penetrationState.penetrationData?.length || 0) / rowsPerPage
  );

  const handleRowsPerPageChange = (e) => {
    setRowsPerPage(Number(e.target.value));
    setCurrentPage(0);
  };

  const handleBack = () => {
    setCurrentPage((prev) => Math.max(prev - 1, 0));
  };

  const handlePaginationNext = () => {
    setCurrentPage((prev) => Math.min(prev + 1, totalPages - 1));
  };

  const handleNext = async () => {
    const values = {
      city: classificationState.city || "",
      base_year: classificationState.baseYear || "",
      vehicle_type: classificationState.vehicleType || "",
      projected_year: penetrationState.projectedYear || "",
      user_id: classificationState.userId || "",
      file: penetrationState.penetrationFile || null,
    };

    const formData = new FormData();
    formData.append("city_name", values.city);
    formData.append("base_year", values.base_year);
    formData.append("vehicle_type", values.vehicle_type);
    formData.append("projected_year", values.projected_year);

    const storedTransactionId =
      localStorage.getItem("transaction_id") || "emission-analysis-2025";
    formData.append("transaction_id", storedTransactionId);

    if (values.user_id) formData.append("user_id", values.user_id);
    if (values.file) formData.append("file", values.file);

    try {
      const res = await fetch(`${API_URL}/upload/penetration_rate`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      console.log("Backend response:", data);
      window.dispatchEvent(
        new CustomEvent("app-notification", { detail: { text: "Vehicle penetration data saved successfully!" } })
      );
    } catch (err) {
      window.dispatchEvent(
        new CustomEvent("app-notification", { detail: { text: "Error: Please enter a valid value for all fields." } })
      );
    }
  };

  React.useEffect(() => {
    setCurrentPage(0);
  }, [penetrationState.penetrationData, rowsPerPage]);

  const vehicleTypeColIndex = React.useMemo(() => {
    const headers = penetrationState.penetrationHeaders || [];
    const norm = (s) =>
      String(s || "").trim().toLowerCase().replace(/\s+/g, "");
    const idx = headers.findIndex(
      (h) =>
        norm(h) === "vehicletype" ||
        norm(h) === "vehicle_type" ||
        /vehicle.*type/i.test(String(h))
    );
    return idx > -1 ? idx : 0;
  }, [penetrationState.penetrationHeaders]);

  const filterByVehicle = React.useCallback((rows, vehicleType, vtIndex) => {
    if (!rows || rows.length === 0) return [];
    if (!vehicleType) return rows;
    const vt = vehicleType.toString().trim().toLowerCase();
    const filtered = rows.filter(
      (row) =>
        String(row?.[vtIndex] ?? "").trim().toLowerCase() === vt
    );
    return filtered.length > 0 ? filtered : rows;
  }, []);

  React.useEffect(() => {
    setLocalVehicleFilter("");
  }, [penetrationState.allPenetrationData]);

  React.useEffect(() => {
    const next = filterByVehicle(
      penetrationState.allPenetrationData,
      localVehicleFilter,
      vehicleTypeColIndex
    );
    setPenetrationState({ penetrationData: next });
  }, [
    localVehicleFilter,
    penetrationState.allPenetrationData,
    vehicleTypeColIndex,
    filterByVehicle,
    setPenetrationState,
  ]);

  return (
    <div className="flex flex-row items-stretch gap-6 pt-4 w-full">
      {/* Left panel */}
      <div className="flex-1 flex flex-col">
        <div className="mb-4 pb-3 border-b border-gray-200">
          <h2 className={`text-2xl font-bold tracking-tight ${theme === "dark" ? "text-white" : "text-gray-800"}`}>Projected Vehicle Penetration Rate Data</h2>
          <p className={`text-sm mt-1 ${theme === "dark" ? "text-gray-400" : "text-gray-500"}`}>Upload penetration rate projections for each year from base year to end year.</p>
        </div>
        <div className="w-full flex flex-col gap-6">
          {/* Guidance */}
          <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
            <p className="font-semibold mb-1">Upload Projected Penetration Rate Data</p>
            <p className="text-green-700">
              Upload a CSV or Excel file with columns:{" "}
              <code className="bg-green-100 px-1 rounded text-xs">Vehicle Type</code>,{" "}
              <code className="bg-green-100 px-1 rounded text-xs">Fuel Type</code>,{" "}
              <code className="bg-green-100 px-1 rounded text-xs">Age</code>,{" "}
              <code className="bg-green-100 px-1 rounded text-xs">Vehicle Count</code>.
              Each row represents a projected vehicle category with its fuel type, age, and count.
            </p>
            <a
              href="/penetration_rate_template.csv"
              download="penetration_rate_template.csv"
              className="inline-flex items-center gap-1 mt-2 text-green-600 hover:text-green-800 font-medium text-xs underline"
            >
              <FileSpreadsheet className="w-3 h-3" />
              Download template CSV
            </a>
          </div>

          {/* Base Year + End Year + City row */}
          <div className="flex flex-row gap-4 items-end">
            {/* Base Year — regular dropdown */}
            <div className="flex flex-col gap-1 min-w-[80px] max-w-[100px]">
              <label className="text-xs font-medium text-gray-600 cursor-help" title="The starting reference year for your data, set in Step 1 (Vehicle Classification).">Base Year</label>
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
            {/* End Year — regular dropdown, same style as Base Year */}
            <div className="flex flex-col gap-1 min-w-[110px] max-w-[130px]">
              <label className="text-xs font-medium text-gray-600 cursor-help" title="The simulation end year. All steps will generate data from the base year through this year. Extend it to cover your latest ABM upload year.">End Year</label>
              <select
                value={penetrationState.projectedYear || ""}
                onChange={(e) => {
                  setPenetrationState({
                    projectedYear: e.target.value,
                    selectedYear: null,
                  });
                }}
                className={`border rounded px-2 py-1 w-full h-[32px] ${
                  theme === "dark"
                    ? "bg-[#18181b] text-white border-gray-700"
                    : "bg-white text-black border-gray-300"
                }`}
              >
                <option value="">End Year</option>
                {classificationState.baseYear &&
                  Array.from(
                    { length: 30 },
                    (_, i) => parseInt(classificationState.baseYear, 10) + i + 1
                  ).map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
              </select>
            </div>
            {/* City */}
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

          {/* Year Upload Box + Upload button */}
          {yearList.length > 0 && (
            <>
              {/* Year list box — constrained to City dropdown width */}
              <div className={`border rounded-lg overflow-hidden ${theme === "dark" ? "border-gray-700" : "border-gray-300"}`} style={{ maxWidth: 420 }}>
                <div className="overflow-y-auto" style={{ maxHeight: 180 }}>
                  {yearList.map((year) => {
                    const isUploaded = !!yearUploads[year];
                    const isSelected = selectedYear === year;
                    return (
                      <div
                        key={year}
                        onClick={() => setPenetrationState({ selectedYear: year })}
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
                          {year} Projected Vehicle Penetration Rate Data
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Upload button — right-aligned, same position as old Projected Penetration button */}
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
                    accept=".xlsx, .xls, .csv"
                    onChange={handleFileChange}
                    disabled={!selectedYear}
                    className="hidden"
                  />
                </label>
              </div>
            </>
          )}

          {/* Table — shown when selected year has data */}
          {penetrationState.penetrationData?.length > 0 && selectedYear ? (
            <div className="flex-1 w-full min-w-0 overflow-auto" style={{ minHeight: 320, maxHeight: 480 }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center">
                  <label className="mr-2 font-semibold">Filter by Vehicle Type:</label>
                  <select
                    value={localVehicleFilter}
                    onChange={(e) => setLocalVehicleFilter(e.target.value)}
                    disabled={!penetrationState.penetrationFile}
                    className={`border rounded px-2 py-1 transition-colors duration-300 disabled:opacity-50 disabled:cursor-not-allowed ${
                      theme === "dark"
                        ? "bg-[#18181b] text-white border-gray-700"
                        : "bg-white text-black border-gray-300"
                    }`}
                  >
                    <option value="">Vehicle Type</option>
                    <option value="Combination long-haul Truck">Combination long-haul Truck</option>
                    <option value="Combination short-haul Truck">Combination short-haul Truck</option>
                    <option value="Light Commercial Truck">Light Commercial Truck</option>
                    <option value="Motorhome - Recreational Vehicle">Motorhome - Recreational Vehicle</option>
                    <option value="Motorcycle">Motorcycle</option>
                    <option value="Other Buses">Other Buses</option>
                    <option value="Passenger Truck">Passenger Truck</option>
                    <option value="Refuse Truck">Refuse Truck</option>
                    <option value="School Bus">School Bus</option>
                    <option value="Single Unit long-haul Truck">Single Unit long-haul Truck</option>
                    <option value="Single Unit short-haul Truck">Single Unit short-haul Truck</option>
                    <option value="Transit Bus">Transit Bus</option>
                  </select>
                </div>
                <div className="flex items-center">
                  <label className="mr-2 font-semibold">Rows per page:</label>
                  <select
                    value={rowsPerPage}
                    onChange={handleRowsPerPageChange}
                    className="border rounded px-2 py-1"
                    style={{ width: 80 }}
                  >
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                </div>
              </div>
              <HotTable
                data={displayData}
                colHeaders={displayHeaders}
                columns={columnConfig}
                afterChange={handleTableChange}
                rowHeaders
                stretchH="all"
                height={350}
                width="100%"
                licenseKey="non-commercial-and-evaluation"
                themeName={
                  theme === "dark" ? "ht-theme-main-dark" : "ht-theme-main"
                }
                afterGetColHeader={(col, TH) => {
                  TH.style.textAlign = "center";
                  TH.style.fontWeight = "bold";
                }}
              />
              <div className="flex flex-col sm:flex-row justify-between gap-2 sm:gap-4 mt-4">
                <button
                  className="px-6 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50"
                  onClick={handleBack}
                  disabled={currentPage === 0}
                  type="button"
                >
                  <i className="bi bi-chevron-left"></i>
                </button>
                <span className="px-2 py-2 font-semibold">
                  Page {currentPage + 1} of {totalPages}
                </span>
                <button
                  className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                  onClick={handlePaginationNext}
                  disabled={currentPage >= totalPages - 1}
                  type="button"
                >
                  <i className="bi bi-chevron-right"></i>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 w-full min-w-0 overflow-auto">
              {/* placeholder */}
            </div>
          )}
        </div>
      </div>

      {/* Right panel: map */}
      <div className="flex flex-col gap-4 w-64 shrink-0">
        {classificationState.city && cityImages[classificationState.city] && (
          <img
            src={cityImages[classificationState.city]}
            alt={classificationState.city}
            className="w-full max-h-[350px] object-contain rounded"
          />
        )}
      </div>
    </div>
  );
}

export default VehiclePenetration;
