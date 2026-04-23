import React from "react";
import { CloudUpload } from "lucide-react";
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
    "Traffic Volume and Speed",
    "Projected Demand",
  ];

  // Pagination state
  const [currentPage, setCurrentPage] = React.useState(0);
  const [rowsPerPage, setRowsPerPage] = React.useState(20);

  // Paginated data
  const paginatedData =
    penetrationState.penetrationData?.slice(
      currentPage * rowsPerPage,
      (currentPage + 1) * rowsPerPage
    ) || [];

  // Find the primary numeric column (Vehicle Count, Count, or Penetration)
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

  // Display headers: append "Vehicle %" when a numeric column exists
  const displayHeaders = React.useMemo(() => {
    const headers = penetrationState.penetrationHeaders || [];
    if (numericColIndex < 0) return headers;
    return [...headers, "Vehicle %"];
  }, [penetrationState.penetrationHeaders, numericColIndex]);

  // Total for the current page (for percentage calculation)
  const totalNumericValue = React.useMemo(() => {
    if (numericColIndex < 0) return 0;
    return paginatedData.reduce(
      (sum, row) => sum + (parseFloat(row?.[numericColIndex]) || 0), 0
    );
  }, [paginatedData, numericColIndex]);

  // Display data: paginated rows with computed percentage appended
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

  // Column config: center numeric columns, percentage column is read-only
  const columnConfig = React.useMemo(() => {
    if (numericColIndex < 0) return undefined;
    const headers = penetrationState.penetrationHeaders || [];
    return [
      ...headers.map(() => ({ className: "htCenter" })),
      { readOnly: true, className: "htDimmed htCenter" }
    ];
  }, [penetrationState.penetrationHeaders, numericColIndex]);

  // Handle cell edits — persist changes back to allPenetrationData
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

  // Pagination Next - only for table pagination
  const handlePaginationNext = () => {
    setCurrentPage((prev) => Math.min(prev + 1, totalPages - 1));
  };

  // Send data to backend on Next
  // Helper to print the current values and file in the console
  const printPenetrationValues = React.useCallback(() => {
    const values = {
      city: classificationState.city || "",
      base_year: classificationState.baseYear || "",
      vehicle_type: classificationState.vehicleType || "",
      projected_year: penetrationState.projectedYear || "",
      user_id: classificationState.userId || "",
      file: penetrationState.penetrationFile || null,
    };
    console.log("Penetration upload values:", {
      ...values,
      file: values.file ? values.file.name : null,
    });
  }, [
    classificationState.city,
    classificationState.baseYear,
    classificationState.vehicleType,
    classificationState.userId,
    penetrationState.projectedYear,
    penetrationState.penetrationFile,
  ]);

  // Print values whenever file or any value changes
  React.useEffect(() => {
    printPenetrationValues();
  }, [printPenetrationValues]);

  const handleNext = async () => {
    // Combine all values and file data into a single variable
    const values = {
      city: classificationState.city || "",
      base_year: classificationState.baseYear || "",
      vehicle_type: classificationState.vehicleType || "",
      projected_year: penetrationState.projectedYear || "",
      user_id: classificationState.userId || "",
      file: penetrationState.penetrationFile || null,
    };

    // Prepare FormData for backend (file upload)
    const formData = new FormData();
    formData.append("city_name", values.city);
    formData.append("base_year", values.base_year);
    formData.append("vehicle_type", values.vehicle_type);
    formData.append("projected_year", values.projected_year);

    // Add transaction_id from localStorage or default
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
      // Optionally show a message or move to next page
    } catch (err) {
      window.dispatchEvent(
        new CustomEvent("app-notification", { detail: { text: "Error: Please enter a valid value for all fields." } })
      );
    }
    // Don't change pagination here - this is for step progression
  };

  // Reset page when data changes or rowsPerPage changes
  React.useEffect(() => {
    setCurrentPage(0);
  }, [penetrationState.penetrationData, rowsPerPage]);

  // guess "Vehicle Type" column index from headers; fallback to col 0
  const vehicleTypeColIndex = React.useMemo(() => {
    const headers = penetrationState.penetrationHeaders || [];
    const norm = (s) =>
      String(s || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "");
    const idx = headers.findIndex(
      (h) =>
        norm(h) === "vehicletype" ||
        norm(h) === "vehicle_type" ||
        /vehicle.*type/i.test(String(h))
    );
    return idx > -1 ? idx : 0;
  }, [penetrationState.penetrationHeaders]);

  // filter helper using the detected column index
  const filterByVehicle = React.useCallback((rows, vehicleType, vtIndex) => {
    if (!rows || rows.length === 0) return [];
    if (!vehicleType) return rows;
    const vt = vehicleType.toString().trim().toLowerCase();
    const filtered = rows.filter(
      (row) =>
        String(row?.[vtIndex] ?? "")
          .trim()
          .toLowerCase() === vt
    );
    // fallback to full rows to avoid an empty table if the value isn't present
    return filtered.length > 0 ? filtered : rows;
  }, []);

  // derive filtered table from original data whenever vehicle type changes (or file changes)
  React.useEffect(() => {
    const next = filterByVehicle(
      penetrationState.allPenetrationData,
      classificationState.vehicleType,
      vehicleTypeColIndex
    );
    setPenetrationState({ penetrationData: next });
  }, [
    classificationState.vehicleType,
    penetrationState.allPenetrationData,
    vehicleTypeColIndex,
    filterByVehicle,
    setPenetrationState,
  ]);

  const fileInputRef = React.useRef();
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPenetrationState({ penetrationFile: file });

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
        setPenetrationState({
          penetrationHeaders: headers,
          allPenetrationData: rows, // store original, unfiltered rows
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
      // Reset file input so the same file can be uploaded again after year change
      if (fileInputRef.current) fileInputRef.current.value = "";
    };

    if (file.name.toLowerCase().endsWith(".csv")) reader.readAsText(file);
    else reader.readAsBinaryString(file);
  };

  return (
    <div className="flex flex-row items-stretch gap-6 pt-4 w-full">
      {/* Left panel: form + table */}
      <div className="flex-1 flex flex-col">
        <div className="w-full flex flex-col gap-6">
          <form className="flex flex-col gap-2 md:gap-4 p-2 md:p-4 rounded transition-colors duration-300 w-full min-w-0 overflow-x-auto">
            <div className="flex flex-col md:flex-row gap-2 md:gap-4 w-full items-end">
              {/* Projected Year */}
              <div className="flex flex-col gap-1 min-w-[80px] max-w-[100px] w-auto">
                <label className="text-xs font-medium text-gray-600">Year</label>
                <select
                  value={penetrationState.projectedYear || ""}
                  onChange={(e) => {
                    setPenetrationState({ projectedYear: e.target.value });
                  }}
                  className={`border rounded px-2 py-1 w-full h-[32px] ${
                    theme === "dark"
                      ? "bg-[#18181b] text-white border-gray-700"
                      : ""
                  }`}
                >
                  <option value="" disabled>Year</option>
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
              {/* Base Year */}
              <div className="flex flex-col gap-1 min-w-[80px] max-w-[100px] w-auto">
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
              {/* Vehicle Type */}
              <div className="flex flex-col gap-1 flex-1 min-w-0">
                <label className="text-xs font-medium text-gray-600">Vehicle Type</label>
                <select
                  value={classificationState.vehicleType}
                  onChange={(e) =>
                    setClassificationState({ vehicleType: e.target.value })
                  }
                  disabled={!penetrationState.penetrationFile}
                  className={`border rounded px-2 py-1 w-full transition-colors duration-300 disabled:opacity-50 disabled:cursor-not-allowed ${
                    theme === "dark"
                      ? "bg-[#18181b] text-white border-gray-700"
                      : "bg-white text-black border-gray-300"
                  }`}
                  style={{ minWidth: '220px', maxWidth: '340px', flexShrink: 1 }}
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
              {/* City */}
              <div className="flex flex-col gap-1 min-w-[120px] max-w-[180px] w-full">
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
            {/* Projected Penetration upload button below City, right-aligned and smaller */}
            <div className="flex w-full justify-end mt-2">
              <label
                className={`flex items-center font-semibold px-3 py-1.5 rounded h-[36px] text-sm transition-colors duration-300 whitespace-nowrap w-full max-w-[300px]
                  ${!penetrationState.projectedYear ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}
                  ${theme === "dark" ? "bg-blue-700 hover:bg-blue-800 text-white" : "bg-blue-600 hover:bg-blue-700 text-white"}`}
                style={{ minWidth: 0 }}
              >
                <span className="flex items-center gap-2 w-full justify-center">
                  Projected Penetration
                  <CloudUpload className="w-4 h-4" />
                </span>
                <input
                  type="file"
                  accept=".xlsx, .xls, .csv"
                  onChange={handleFileChange}
                  disabled={!penetrationState.projectedYear}
                  className="hidden"
                />
              </label>
            </div>
          </form>

        {penetrationState.penetrationData?.length > 0 ? (
          <div className="flex-1 w-full min-w-0 overflow-auto" style={{ minHeight: 320, maxHeight: 480 }}>
            <div className="flex items-center justify-end mb-2">
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
            {/* placeholder table */}
          </div>
        )}
        </div>
      </div>

      {/* Right panel: only map image if available */}
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
