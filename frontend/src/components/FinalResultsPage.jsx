import useAppStore from "../useAppStore";
import Button from "@mui/material/Button";
import { useState } from "react";
import GridChartR3 from "./GridChartR3";
import VehicleChartR1R2 from "./VehicleChartR1R2";


const FinalResultsPage = ({ resultsSelection, setResultsSelection }) => {
  const [dailyAnnualSelection, setDailyAnnualSelection] = useState("DAILY");
  const ConsumptionAndEmissionState = useAppStore(
    (s) => s.ConsumptionAndEmission
  );
  const setConsumptionAndEmissionState = useAppStore(
    (s) => s.setConsumptionAndEmission
  );
  const theme = useAppStore((s) => s.theme);
  const classificationState = useAppStore((state) => state.classificationState);
  const FUEL_TYPES = ["CNG", "Diesel", "Electricity", "Ethanol", "Gasoline"];
  const EMISSION_TYPES = [
    { label: "CO₂", value: "CO2" },
    { label: "NOₓ", value: "NOx" },
    { label: "PM2.5B", value: "PM2.5B" },
    { label: "PM2.5T", value: "PM2.5T" },
  ];
  const cityName = classificationState.city || classificationState.cityInput;
  const fuelType = ConsumptionAndEmissionState.FuelType || "";
  const emissionType = ConsumptionAndEmissionState.EmissionType || "";
  const chartMode = dailyAnnualSelection === "DAILY" ? "R1" : "R2";
  return (
    <div className="flex flex-col gap-6">
      {/* Control Panel - All dropdowns in one row */}
      <div className="flex flex-row gap-4 justify-center items-end">
        <div className="flex flex-col gap-[2px]">
          <label className="text-xs font-medium text-gray-600">
            Vehicle / Grid
          </label>
          <select
            value={resultsSelection}
            onChange={(e) => {
              setResultsSelection(e.target.value);
            }}
            className="border rounded px-2 py-1 w-48"
          >
            <option value="">Select Vehicle/Grid</option>
            <option value="VEHICLE">Vehicle</option>
            <option value="GRID">Grid</option>
          </select>
        </div>

        {resultsSelection !== "GRID" && (
          <div className="flex flex-col gap-[2px]">
            <label className="text-xs font-medium text-gray-600">
              Daily / Annual
            </label>
            <select
              value={dailyAnnualSelection}
              onChange={(e) => {
                setDailyAnnualSelection(e.target.value);
              }}
              className="border rounded px-2 py-1 w-48"
            >
              <option value="">Select Daily/Annual</option>
              <option value="DAILY">Daily</option>
              <option value="ANNUAL">Annual</option>
            </select>
          </div>
        )}

        {resultsSelection === "VEHICLE" && (
          <>
            <div className="flex flex-col gap-[2px]">
              <label className="text-xs font-medium text-gray-600">
                Fuel Type
              </label>
              <select
                value={fuelType}
                onChange={(e) => {
                  setConsumptionAndEmissionState({ FuelType: e.target.value });
                }}
                className="border rounded px-2 py-1 w-48"
              >
                <option value="">Select Fuel Type</option>
                {FUEL_TYPES.map((ft) => (
                  <option key={ft} value={ft}>
                    {ft}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-[2px]">
              <label className="text-xs font-medium text-gray-600">
                Emission Type
              </label>
              <select
                value={emissionType}
                onChange={(e) => {
                  setConsumptionAndEmissionState({
                    EmissionType: e.target.value,
                  });
                }}
                className="border rounded px-2 py-1 w-48"
              >
                <option value="">Select Emission Type</option>
                {EMISSION_TYPES.map((et) => (
                  <option
                    key={et.label}
                    value={et.value}
                    dangerouslySetInnerHTML={{ __html: et.label }}
                  />
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-[2px]">
              <label className="text-xs font-medium text-gray-600">City</label>
              <select
                disabled
                className={`border rounded px-2 py-1 w-48 bg-gray-300 cursor-not-allowed ${
                  theme === "dark"
                    ? "bg-[#18181b] text-white border-gray-700"
                    : "text-gray-700 border-gray-400"
                }`}
              >
                <option>{classificationState.city || "City"}</option>
              </select>
            </div>
          </>
        )}

      </div>

      {/* Content Area - Charts and Map */}
      <div className="flex flex-row gap-6 items-center">
        {resultsSelection === "VEHICLE" && (
          <>
            <div className="flex flex-col gap-8 flex-1">
              {/* Fuel Chart */}
              {fuelType && (
                <div className="w-full border border-gray-200 rounded-lg bg-white shadow-sm p-3">
                  <div className="text-xs font-semibold text-gray-500 mb-1">{fuelType} Consumption</div>
                  <VehicleChartR1R2 metric={fuelType} cityName={cityName} mode={chartMode} />
                </div>
              )}
              {/* Emission Chart */}
              {emissionType && (
                <div className="w-full border border-gray-200 rounded-lg bg-white shadow-sm p-3">
                  <div className="text-xs font-semibold text-gray-500 mb-1"
                    dangerouslySetInnerHTML={{
                      __html: `${emissionType.replace("CO2","CO<sub>2</sub>").replace("NOx","NO<sub>x</sub>")} Emission`,
                    }}
                  />
                  <VehicleChartR1R2 metric={emissionType} cityName={cityName} mode={chartMode} />
                </div>
              )}
            </div>
            <div className="flex flex-col gap-4 flex-shrink-0 ml-4">
              {/* Census Tract Legend */}
              <div
                style={{
                  minWidth: 200,
                  padding: 12,
                  border: "1px solid rgba(0,0,0,0.2)",
                  borderRadius: 8,
                  background: "rgba(255,255,255,0.88)",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                  fontSize: 12,
                  color: "#555",
                }}
              >
                <div style={{ fontWeight: "bold", marginBottom: 6, fontSize: 13 }}>
                  About the chart
                </div>
                <p>Each line represents one <strong>census tract</strong> — a geographic sub-area of the selected city.</p>
                <p style={{ marginTop: 8 }}>Hover to inspect individual tract values. Scroll to zoom, drag to pan.</p>
                <p style={{ marginTop: 8, color: "#888" }}>
                  {dailyAnnualSelection === "DAILY"
                    ? "R1 — Daily emissions by hour of day"
                    : "R2 — Annual emissions by year (2024–2030)"}
                </p>
              </div>
            </div>
          </>
        )}

        {resultsSelection === "GRID" && (
          <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto">
            {/* CO2 Grid Chart */}
            <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
              <div className="text-xs font-semibold text-gray-500 mb-2">CO₂</div>
              <GridChartR3 emissionType="CO2" cityName={cityName} />
            </div>
            {/* CH4 Grid Chart */}
            <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
              <div className="text-xs font-semibold text-gray-500 mb-2">CH₄</div>
              <GridChartR3 emissionType="CH4" cityName={cityName} />
            </div>
            {/* N2O Grid Chart */}
            <div className="p-3 rounded-lg bg-gray-50 border border-gray-200">
              <div className="text-xs font-semibold text-gray-500 mb-2">N₂O</div>
              <GridChartR3 emissionType="N2O" cityName={cityName} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FinalResultsPage;