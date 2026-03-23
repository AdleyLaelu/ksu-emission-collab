import React, { useMemo, useState, useEffect, useRef } from "react";
import useAppStore from "../useAppStore";
import Atlanta from "../assets/Georgia.svg";
import LosAngeles from "../assets/California.svg";
import Seattle from "../assets/Seattle.svg";
import NewYork from "../assets/NewYork.svg";
import VehicleStepper from "./VerticalStepper";
import { Button } from "@mui/material";

import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
import annotationPlugin from 'chartjs-plugin-annotation';
import zoomPlugin from 'chartjs-plugin-zoom';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  annotationPlugin,
  zoomPlugin
);
// --- Reusable Zoom Toolbar Component ---
const ZoomToolbar = ({ onZoomIn, onZoomOut, onReset }) => (
  <div className="absolute top-4 right-4 z-10 flex bg-white rounded border border-gray-300 shadow-sm overflow-hidden select-none">
    <button
      onClick={onZoomIn}
      className="px-3 py-1 text-blue-600 hover:bg-gray-50 border-r border-gray-200 text-lg font-bold leading-none transition-colors"
      title="Zoom In"
      type="button"
    >
      +
    </button>
    <button
      onClick={onZoomOut}
      className="px-3 py-1 text-blue-600 hover:bg-gray-50 border-r border-gray-200 text-lg font-bold leading-none transition-colors"
      title="Zoom Out"
      type="button"
    >
      -
    </button>
    <button
      onClick={onReset}
      className="px-3 py-1 text-xs font-semibold text-blue-600 hover:bg-gray-50 uppercase tracking-wide transition-colors"
      title="Reset Zoom"
      type="button"
    >
      RESET
    </button>
  </div>
);

const VEHICLE_TYPES = [
  "Combination Long-haul Truck",
  "Combination Short-haul Truck",
  "Light Commercial Truck",
  "Motorhome - Recreational Vehicle",
  "Motorcycle",
  "Other Buses",
  "Passenger Car",
  "Passenger Truck",
  "Refuse Truck",
  "School Bus",
  "Single Unit Long-haul Truck",
  "Single Unit Short-haul Truck",
  "Transit Bus",
];

const FUEL_TYPES = [
  "Compressed Natural Gas - CNG",
  "Diesel Fuel",
  "Electricity",
  "Ethanol - E-85",
  "Gasoline",
];

const EMISSION_TYPES = [
  { label: "CO₂ Emissions", display: "CO₂ Emissions", value: "CO₂ Emissions", backend: "CO2 Emissions", unit: "g/mi" },
  { label: "Energy Rate", display: "Energy Rate", value: "Energy Rate", backend: "Energy Rate", unit: "MWh/mile" },
  { label: "NOₓ", display: "NOₓ", value: "NOₓ", backend: "NOx", unit: "g/mi" },
  { label: "PM2.5 Brake Wear", display: "PM2.5 Brake Wear", value: "PM2.5 Brake Wear", backend: "PM2.5 Brake Wear", unit: "g/mi" },
  { label: "PM2.5 Tire Wear", display: "PM2.5 Tire Wear", value: "PM2.5 Tire Wear", backend: "PM2.5 Tire Wear", unit: "g/mi" },
];

function getRandomColor(idx) {
  // Generate visually distinct colors
  const colors = [
    "#1f77b4",
    "#ff7f0e",
    "#2ca02c",
    "#d62728",
    "#9467bd",
    "#8c564b",
    "#e377c2",
    "#7f7f7f",
    "#bcbd22",
    "#17becf",
    "#a55194",
    "#393b79",
    "#637939",
  ];
  return colors[idx % colors.length];
}

export default function EnergyConsumptionAndEmissionRates() {
  // Chart refs for zoom controls
  const consumptionChartRef = useRef(null);
  const emissionChartRef = useRef(null);

  // Zoom Handlers
  const handleZoomIn = (chartRef) => {
    if (chartRef.current) chartRef.current.zoom(1.1);
  };
  const handleZoomOut = (chartRef) => {
    if (chartRef.current) chartRef.current.zoom(0.9);
  };
  const handleResetZoom = (chartRef) => {
    if (chartRef.current) chartRef.current.resetZoom();
  };
  // Store slices
  const addNotification = useAppStore((s) => s.addNotification);
  const classificationState = useAppStore((s) => s.classificationState);
  const ConsumptionAndEmissionState = useAppStore(
    (s) => s.ConsumptionAndEmission
  );
  const setConsumptionAndEmissionState = useAppStore(
    (s) => s.setConsumptionAndEmission
  );

  // State for real chart data
  const [updateCounter, setUpdateCounter] = useState(0);
  const [consumptionUnit, setConsumptionUnit] = useState("units");
  const [emissionUnit, setEmissionUnit] = useState("units");

  // Remember last requested inputs so we only refetch datasets when the relevant input changes
  const [lastEmissionTypeRequested, setLastEmissionTypeRequested] =
    useState(null);
  const [lastFuelTypeRequested, setLastFuelTypeRequested] = useState(null);

  // Use Zustand for vehicle data (persist across steps)
  const vehicleData = useAppStore((s) => s.vehicleData);
  const setVehicleData = useAppStore((s) => s.setVehicleData);
  const resetVehicleData = useAppStore((s) => s.resetVehicleData);

  // Ref for potential direct chart manipulation (future use)
  // const chartRef = useRef(null);

  // State for chart data
  const [emissionChartData, setEmissionChartData] = useState({
    labels: [],
    datasets: [
      {
        label: "No Data Yet",
        data: [],
        borderColor: "#ccc",
        backgroundColor: "rgba(0,0,0,0)",
        tension: 0.3,
        pointRadius: 0,
      },
    ],
  });
  const [consumptionChartData, setConsumptionChartData] = useState({
    labels: [],
    datasets: [
      {
        label: "No Data Yet",
        data: [],
        borderColor: "#ccc",
        backgroundColor: "rgba(0,0,0,0)",
        tension: 0.3,
        pointRadius: 0,
      },
    ],
  });
  // Emission chart axis helpers (previously computed; removed to use simple axis settings)

  // useEffect to update chart data when vehicleData changes
  useEffect(() => {
    const vehicleColorMap = VEHICLE_TYPES.reduce((acc, type, idx) => {
      acc[type] = getRandomColor(idx);
      return acc;
    }, {});

    const consumptionDatasets = [];
    const emissionDatasets = [];
    let consumptionUnitTemp = "units";
    let emissionUnitTemp = "units";

    Object.entries(vehicleData).forEach(([dataKey, data]) => {
      // Handle the nested data structure from your backend
      let actualData = data;
      let dataPoints = [];
      // Check if this is consumption data or emissions data
      if (dataKey.endsWith("_Consumption")) {
        // Handle consumption data - array of speed/consumption pairs
        if (data.results && Array.isArray(data.results)) {
          // Deduplicate by speed: keep only the first occurrence for each speed
          const seenSpeeds = new Set();
          dataPoints = data.results
            .map((r) => ({ x: r.speed, y: r.consumption }))
            .filter((point) => {
              if (seenSpeeds.has(point.x)) return false;
              seenSpeeds.add(point.x);
              return true;
            })
            .sort((a, b) => a.x - b.x);
          // Get consumption unit from the stored data
          if (data.unit) {
            consumptionUnitTemp = data.unit;
          }
        } else {
          return; // Skip if no consumption data
        }
      } else {
        // Handle emissions data - check for nested "0" structure
        if (data && data["0"] && !data.results) {
          actualData = data["0"];
        }
        if (!actualData || !actualData.results) {
          return;
        }
        const results = actualData.results;
        dataPoints = results
          .map((r) => ({ x: r.speed, y: r.prediction }))
          .sort((a, b) => a.x - b.x);
        // Get emission unit
        if (actualData.unit) {
          emissionUnitTemp = actualData.unit;
        }
      }

      // Extract vehicle type from the key (remove _Consumption or _Selected suffix)
      const vehicleType = dataKey.replace(/_Consumption$|_Selected$/, "");

      const newDataset = {
        label: vehicleType,
        data: dataPoints,
        borderColor: vehicleColorMap[vehicleType] || "#000",
        backgroundColor: "rgba(0,0,0,0)",
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 1, // Make lines thinner
        parsing: {
          xAxisKey: "x",
          yAxisKey: "y",
        },
      };

      // Use prediction_type from backend or the stored emission type
      const predictionType =
        actualData.prediction_type || data.emissionType || "CO2 Emissions";

      // Separate data based on whether it's Fuel Consumption or the selected emission type
      if (
        predictionType === "Fuel Consumption" ||
        dataKey.endsWith("_Consumption")
      ) {
        consumptionDatasets.push(newDataset);
      } else {
        // All emission types go to the emission chart (right side)
        emissionDatasets.push(newDataset);
      }
    });

    // Update units separately
    setConsumptionUnit(consumptionUnitTemp);
    setEmissionUnit(emissionUnitTemp);

    // Handle empty data case
    if (consumptionDatasets.length === 0) {
      setConsumptionChartData({
        labels: [],
        datasets: [
          {
            label: "No Data Available",
            data: [],
            borderColor: "#ccc",
            backgroundColor: "rgba(0,0,0,0)",
            tension: 0.3,
            pointRadius: 0,
          },
        ],
      });
    } else {
      setConsumptionChartData({
        labels: [], // Not needed for scatter plots
        datasets: consumptionDatasets,
      });
    }

    if (emissionDatasets.length === 0) {
      setEmissionChartData({
        labels: [],
        datasets: [
          {
            label: "No Data Available",
            data: [],
            borderColor: "#ccc",
            backgroundColor: "rgba(0,0,0,0)",
            tension: 0.3,
            pointRadius: 0,
          },
        ],
      });
    } else {
      setEmissionChartData({
        labels: [], // Not needed for scatter plots
        datasets: emissionDatasets,
      });
    }

    // Increment update counter to force chart re-render
    setUpdateCounter((prev) => prev + 1);
  }, [vehicleData]);

  // UI lists & lookups
  const statesList = ["", "Atlanta", "Los Angeles", "Seattle", "NewYork"];
  const cityImages = {
    Atlanta: Atlanta,
    "Los Angeles": LosAngeles,
    Seattle: Seattle,
    NewYork: NewYork,
  };

  // City name mapping to handle space differences
  const cityNameMapping = {
    LosAngeles: "Los Angeles",
    NewYork: "NewYork",
    Atlanta: "Atlanta",
    Seattle: "Seattle",
  };

  const ageOptions = useMemo(
    () => Array.from({ length: 30 }, (_, i) => i + 1),
    []
  );

  // Controlled selections
  const fuelType = ConsumptionAndEmissionState.FuelType || "";
  const emissionType = ConsumptionAndEmissionState.EmissionType || "";
  const vehicleAge = ConsumptionAndEmissionState.VehicleAge || "";
  const selectedEmissionTypeObj = EMISSION_TYPES.find(et => et.value === emissionType || et.label === emissionType) || {};

  // Dynamic label for the consumption chart Y axis: show Energy Rate when electricity selected
  const consumptionYAxisLabel =
    fuelType === "Electricity" ? "Energy Rate" : "Fuel Consumption Rate";
  // Show the selected fuel type in the axis title if available, otherwise fall back to the generic label
  const consumptionYAxisText = `${
    fuelType || consumptionYAxisLabel
  } (${consumptionUnit})`;

  // Only clear EmissionType if fuelType changes and the current emissionType is not valid for the new fuelType
  const prevFuelTypeRef = useRef(fuelType);
  useEffect(() => {
    if (!emissionType) {
      prevFuelTypeRef.current = fuelType;
      return;
    }
    const forbiddenForElectric = new Set(["CO2 Emissions", "NOx"]);
    const allowedLabels = new Set(
      fuelType === "Electricity"
        ? EMISSION_TYPES.filter(
            (et) => !forbiddenForElectric.has(et.label)
          ).map((e) => e.label)
        : EMISSION_TYPES.map((e) => e.label)
    );
    // Only clear if fuelType actually changed and emissionType is not allowed
    if (
      prevFuelTypeRef.current !== fuelType &&
      (emissionType === "Energy Rate" || !allowedLabels.has(emissionType))
    ) {
      setConsumptionAndEmissionState({ EmissionType: "" });
    }
    prevFuelTypeRef.current = fuelType;
  }, [fuelType, emissionType, setConsumptionAndEmissionState]);

  // Fix the city key selection logic with proper mapping
  const rawCityName = classificationState.city || classificationState.cityInput;
  const selectedCityName = cityNameMapping[rawCityName] || rawCityName;
  const selectedCityKey = selectedCityName;

    return (
    <div className="flex flex-row items-stretch gap-6 pt-4" style={{ paddingLeft: '100px' }}>
      {/* Left: controls */}
      <div className="flex flex-col gap-6">
        <form
          className="flex items-end gap-6 p-6 rounded"
          onSubmit={(e) => e.preventDefault()}
        >
          {/* Fuel Type */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-600">
              Fuel Type
            </label>
            <select
              value={fuelType}
              onChange={(e) => {
                setConsumptionAndEmissionState({ FuelType: e.target.value });
              }}
              className="border rounded px-3 py-2 w-70"
            >
              <option value="">Select Fuel Type</option>
              {FUEL_TYPES.map((ft) => (
                <option key={ft} value={ft}>
                  {ft}
                </option>
              ))}
            </select>
          </div>

          {/* Emission Type */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-600">
              Emission Type
            </label>
            <select
              value={selectedEmissionTypeObj.value || ""}
              onChange={(e) => {
                setConsumptionAndEmissionState({ EmissionType: e.target.value });
              }}
              className="border rounded px-3 py-2 w-48"
            >
              <option value="">Select Emission Type</option>
              {(fuelType === "Electricity"
                ? EMISSION_TYPES.filter(
                    (et) =>
                      et.value !== "CO2 Emissions" &&
                      et.value !== "NOx" &&
                      et.value !== "Energy Rate"
                  )
                : EMISSION_TYPES.filter((et) => et.value !== "Energy Rate")
              ).map((et) => (
                <option key={et.value} value={et.value}>
                  {et.value === "CO2 Emissions"
                    ? 'CO2 Emissions'
                    : et.value === "NOx"
                    ? 'NOx'
                    : et.label}
                </option>
              ))}
            </select>
          </div>

          {/* Vehicle Age */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-600">
              Vehicle Age
            </label>
            <select
              value={vehicleAge}
              className="border rounded px-3 py-2 w-32"
              onChange={(e) => {
                setConsumptionAndEmissionState({ VehicleAge: e.target.value });
              }}
            >
              <option value="" disabled>
                Vehicle Age
              </option>
              {ageOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          {/* City (disabled; chosen previously) */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-600">City</label>
            <select
              value={selectedCityName}
              disabled
              className={`bg-gray-300 text-gray-600 rounded px-3 py-2 w-35`}
            >
              <option value="">City</option>
              {statesList.slice(1).map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="contained"
              color="primary"
              disabled={!fuelType || !emissionType || !vehicleAge}
              onClick={async () => {
                try {
                  // Decide whether to fetch consumption and/or emissions this run
                  const shouldFetchConsumption =
                    fuelType !== lastFuelTypeRequested;
                  const shouldFetchEmissions =
                    emissionType !== lastEmissionTypeRequested;

                  // Clear previous data but preserve datasets we are not refetching
                  setVehicleData((prev) => {
                    const preserved = {};
                    if (!shouldFetchConsumption && prev) {
                      Object.entries(prev).forEach(([k, v]) => {
                        if (k.endsWith("_Consumption")) preserved[k] = v;
                      });
                    }
                    if (!shouldFetchEmissions && prev) {
                      Object.entries(prev).forEach(([k, v]) => {
                        if (k.endsWith("_Selected")) preserved[k] = v;
                      });
                    }
                    return preserved;
                  });
                  setUpdateCounter(0);

                  // For each vehicle type, make conditional calls
                  for (const vehicleType of VEHICLE_TYPES) {
                    // Fuel Consumption (left chart) - only when fuel changed
                    if (shouldFetchConsumption) {
                      const speeds = [
                        25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75,
                      ]; // Speed range
                      const consumptionDataPoints = [];
                      addNotification(`Fetching Fuel Consumption for ${vehicleType}...`);

                      for (const speed of speeds) {
                        const consumptionPayload = {
                          fuelType,
                          vehicleAge,
                          city: selectedCityName,
                          vehicleType,
                          speed,
                        };

                        const consumptionRes = await fetch(
                          "http://127.0.0.1:5003/predict_consumption",
                          {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(consumptionPayload),
                          }
                        );
                        // Diagnostic: log payload being sent
                        console.info(
                          "predict_consumption payload:",
                          consumptionPayload
                        );
                        if (!consumptionRes.ok) {
                          const bodyText = await consumptionRes
                            .text()
                            .catch(() => null);
                          console.error(
                            "predict_consumption failed",
                            consumptionRes.status,
                            consumptionRes.statusText,
                            bodyText
                          );
                          throw new Error(
                            `Consumption API error ${consumptionRes.status} ${
                              consumptionRes.statusText
                            } ${bodyText || ""}`
                          );
                        }
                        // Robust parse: some backends may return invalid JSON tokens like NaN
                        let consumptionData;
                        try {
                          const txt = await consumptionRes.text();
                          try {
                            consumptionData = JSON.parse(txt);
                          } catch {
                            const sanitized = txt.replace(/\bNaN\b/g, "null");
                            consumptionData = JSON.parse(sanitized);
                            // addNotification("consumption response contained NaN - parsed after sanitizing");
                          }
                        } catch (e) {
                          throw new Error(
                            "Failed to parse consumption response: " +
                              (e.message || e.toString())
                          );
                        }
                        if (!Array.isArray(consumptionData)) {
                          addNotification("Consumption response is not an array: " + JSON.stringify(consumptionData));
                          throw new Error(
                            "Consumption response is not an array: " +
                              JSON.stringify(consumptionData)
                          );
                        }
                        consumptionData.forEach((item) => {
                          const consumptionValue =
                            item.fuel_consumption !== null
                              ? item.fuel_consumption
                              : item.energy_consumption_mwh_mile;

                          consumptionDataPoints.push({
                            speed: item.speed,
                            consumption: consumptionValue,
                            unit: item.fuel_unit || item.energy_unit,
                          });
                        });
                      }

                      setVehicleData((prev) => ({
                        ...prev,
                        [`${vehicleType}_Consumption`]: {
                          results: consumptionDataPoints,
                          unit:
                            consumptionDataPoints.length > 0
                              ? consumptionDataPoints[0].unit
                              : "units",
                          emissionType: "Fuel Consumption",
                          selectedEmissionType: "Fuel Consumption",
                          timestamp: Date.now(),
                        },
                      }));
                    }

                    // Emissions (right chart) - only when emission type changed
                    if (shouldFetchEmissions) {
                      addNotification(`Fetching ${emissionType} for ${vehicleType}...`);

                      const emissionPayload = {
                        City: selectedCityName,
                        FuelType: fuelType,
                        VehicleType: vehicleType,
                        Age: parseInt(vehicleAge),
                        EmissionType: selectedEmissionTypeObj.backend,
                      };
                      console.info(
                        "predict_emissions payload:",
                        emissionPayload
                      );
                      const selectedRes = await fetch(
                        "http://127.0.0.1:5003/predict_emissions",
                        {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify(emissionPayload),
                        }
                      );

                      if (!selectedRes.ok) {
                        const bodyText = await selectedRes
                          .text()
                          .catch(() => null);
                        console.error(
                          "predict_emissions failed",
                          selectedRes.status,
                          selectedRes.statusText,
                          bodyText
                        );
                        throw new Error(
                          `${emissionType} prediction failed for ${vehicleType}: ${
                            selectedRes.status
                          } ${selectedRes.statusText} ${bodyText || ""}`
                        );
                      }

                      // Robust parse: backend sometimes returns invalid JSON (e.g. NaN). Read text and try to sanitize.
                      let selectedData;
                      try {
                        const txt = await selectedRes.text();
                        try {
                          selectedData = JSON.parse(txt);
                        } catch {
                          // Replace bare NaN tokens with null then parse
                          const sanitized = txt.replace(/\bNaN\b/g, "null");
                          selectedData = JSON.parse(sanitized);
                          // addNotification("predict_emissions response contained NaN - parsed after sanitizing");
                        }
                      } catch (e) {
                        console.error(
                          "Failed to parse predict_emissions response body",
                          e
                        );
                        throw new Error(
                          `Failed to parse emissions response: ${
                            e.message || e.toString()
                          }`
                        );
                      }
                      if (!Array.isArray(selectedData)) {
                        addNotification("Emissions response is not an array: " + JSON.stringify(selectedData));
                        throw new Error(
                          "Emissions response is not an array: " +
                            JSON.stringify(selectedData)
                        );
                      }
                      const transformedData = {
                        results: selectedData.map((item) => ({
                          speed: item.Speed,
                          prediction: item.PredictedValue,
                        })),
                        unit: selectedData[0]?.Unit || "gr/mile",
                        prediction_type:
                          selectedData[0]?.EmissionType || emissionType,
                      };

                      setVehicleData((prev) => ({
                        ...prev,
                        [`${vehicleType}_Selected`]: {
                          ...transformedData,
                          emissionType: emissionType,
                          selectedEmissionType: emissionType,
                          timestamp: Date.now(),
                        },
                      }));

                      addNotification(`Predictions received for ${vehicleType}!`);
                    }
                  }

                  // Update trackers
                  if (shouldFetchConsumption)
                    setLastFuelTypeRequested(fuelType);
                  if (shouldFetchEmissions)
                    setLastEmissionTypeRequested(emissionType);

                  addNotification("✅ All vehicle types processed successfully!");
                } catch (err) {
                  // Log error with full details to help debug the specific failure case
                  console.error("Predict & Plot error", err);
                  const detail =
                    err && (err.message || err.toString())
                      ? err.message || err.toString()
                      : "Unknown error";
                  addNotification("Error contacting backend: " + detail);
                }
              }}
            >
              Predict & Plot
            </Button>
          </div>
        </form>

        {/* Two side-by-side charts as in your PDF */}
        <div className="mt-8 flex flex-row gap-8 justify-center">
          {/* Charts */}
          <div style={{ display: "flex", flexDirection: "row", gap: "2rem" }}>
            <div style={{ width: 420, height: 320, padding: 12, border: "1px solid rgba(0,0,0,0.45)", borderRadius: 8, background: "rgba(255,255,255,0.88)", boxShadow: "0 4px 12px rgba(0,0,0,0.12)", position: 'relative' }}>
              <Line
                ref={consumptionChartRef}
                key={`consumption-${updateCounter}`}
                data={consumptionChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      enabled: true,
                      backgroundColor: '#fff',
                      titleColor: '#222',
                      bodyColor: '#222',
                      borderColor: '#ccc',
                      borderWidth: 1,
                      callbacks: {
                        title: (items) => (items && items[0] && items[0].dataset && items[0].dataset.label) ? items[0].dataset.label : '',
                        label: (item) => {
                          if (!item || !item.parsed) return '';
                          return [
                            `Speed: ${item.parsed.x}`,
                            `${consumptionYAxisText}: ${item.parsed.y}`
                          ];
                        },
                        labelColor: (item) => {
                          if (!item || !item.dataset) return { borderColor: '#ccc', backgroundColor: '#ccc' };
                          return { borderColor: item.dataset.borderColor, backgroundColor: item.dataset.borderColor };
                        },
                        labelTextColor: () => '#222',
                      },
                      displayColors: true,
                    },
                    zoom: {
                      pan: { enabled: true, mode: 'x' },
                      zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
                    },
                  },
                  parsing: { xAxisKey: "x", yAxisKey: "y" },
                  scales: {
                    x: { type: "linear", title: { display: true, text: "Speed (mph)" } },
                    y: { type: "linear", display: true, position: "left", title: { display: true, text: consumptionYAxisText } },
                  },
                }}
              />
              <ZoomToolbar
                onZoomIn={() => handleZoomIn(consumptionChartRef)}
                onZoomOut={() => handleZoomOut(consumptionChartRef)}
                onReset={() => handleResetZoom(consumptionChartRef)}
              />
            </div>
            <div style={{ width: 420, height: 320, padding: 12, border: "1px solid rgba(0,0,0,0.45)", borderRadius: 8, background: "rgba(255,255,255,0.88)", boxShadow: "0 4px 12px rgba(0,0,0,0.12)", position: 'relative' }}>
              <Line
                ref={emissionChartRef}
                key={`emission-${updateCounter}`}
                data={emissionChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      enabled: true,
                      backgroundColor: '#fff',
                      titleColor: '#222',
                      bodyColor: '#222',
                      borderColor: '#ccc',
                      borderWidth: 1,
                      callbacks: {
                        title: (items) => items[0]?.dataset?.label || '',
                        label: (item) => {
                          if (!item || !item.parsed) return '';
                          return [
                            `Speed: ${item.parsed.x}`,
                            `${emissionType || "Selected Emission Type"}: ${item.parsed.y}`
                          ];
                        },
                        labelColor: (item) => {
                          if (!item || !item.dataset) return { borderColor: '#ccc', backgroundColor: '#ccc' };
                          return { borderColor: item.dataset.borderColor, backgroundColor: item.dataset.borderColor };
                        },
                        labelTextColor: () => '#222',
                      },
                      displayColors: true,
                    },
                    zoom: {
                      pan: { enabled: true, mode: 'x' },
                      zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
                    },
                  },
                  parsing: { xAxisKey: "x", yAxisKey: "y" },
                  scales: {
                    x: { type: "linear", title: { display: true, text: "Speed (mph)" }, min: 0, max: 70, ticks: { stepSize: 10 } },
                    y: { type: "linear", display: true, position: "left", title: { display: true, text: `${emissionType || "Selected Emission Type"} (${emissionUnit})` }, min: 0 },
                  },
                }}
              />
              <ZoomToolbar
                onZoomIn={() => handleZoomIn(emissionChartRef)}
                onZoomOut={() => handleZoomOut(emissionChartRef)}
                onReset={() => handleResetZoom(emissionChartRef)}
              />
            </div>
            {/* Shared Legend on the side */}
            <div
              style={{
                minWidth: 240,
                marginLeft: 24,
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-start",
                padding: 12,
                border: "1px solid rgba(0,0,0,0.45)",
                borderRadius: 8,
                background: "rgba(255,255,255,0.88)",
                boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
              }}
            >
              <div
                style={{ fontWeight: "bold", marginBottom: 6, fontSize: 16 }}
              >
                Vehicle Types
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {VEHICLE_TYPES.map((type, idx) => (
                  <div
                    key={type}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      marginBottom: 1,
                    }}
                  >
                    <span
                      style={{
                        display: "inline-block",
                        width: 20,
                        height: 2,
                        backgroundColor: getRandomColor(idx),
                        marginRight: 8,
                        borderRadius: 1,
                      }}
                    />
                    <span style={{ fontSize: 13, fontWeight: 500 }}>
                      {type}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right: map image only (stepper removed) */}
      {/* <div className="flex flex-col gap-6">
        <div>
          {selectedCityKey && cityImages[selectedCityKey] && (
            <img
              src={cityImages[selectedCityKey]}
              alt={selectedCityName}
              className="w-full h-[500px] object-contain rounded"
            />
          )}
        </div>
      </div> */}
    </div>
  );
}
