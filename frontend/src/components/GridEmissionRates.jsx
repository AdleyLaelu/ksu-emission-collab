import React, { useState } from "react";
import useAppStore from "../useAppStore";
import VehicleStepper from "./VerticalStepper";
import GridChartR3, { SCENARIO_COLORS } from "./GridChartR3";
import nrelLogo from "../assets/Logo2.jpg";
import { downloadR3CsvSingle } from "../utils/r3DataUtils";

import {
  Card,
  CardContent,
  Typography,
  List,
  ListItem,
  Divider,
} from "@mui/material";


const GridEmissionRates = ({ activeStep, isResults }) => {
  const [selectedScenarioIdx, setSelectedScenarioIdx] = useState(null);
  const classificationState = useAppStore((state) => state.classificationState);
  const statesList = ["", "Atlanta", "Los Angeles", "Seattle", "NewYork"];

  const scenarios = [
    {
      title: "Mid-case Scenario",
      description:
        "This scenario represents central estimates for fundamental inputs, including moderate renewable energy and battery technology costs (NREL, 2024), EIA AEO2023 Reference natural gas prices (U.S. EIA, 2023), and an average electricity demand growth of 1.8% per year from 2024 to 2050, reaching 6,509 TWh/year by 2050.",
    },
    {
      title: "Low Renewable Energy and Battery Costs",
      description:
        "This scenario mirrors the foundational assumptions of the Mid-case but posits a future where renewable energy and battery costs are considerably lower, using the advanced projections from the 2024 Annual Technology Baseline (ATB) (NREL, 2024), with performance improvements and cost declines, such as wind capital adders decreasing to $0/kW by 2050",
    },
    {
      title: "High Renewable Energy and Battery Costs",
      description:
        "Similar to the Mid-case but this scenario assumes more conservative ATB projections with higher renewable energy and battery costs and a $200/kW capital cost adder for wind through 2050, slowing clean technology adoption.",
    },
    {
      title: "High Demand Growth",
      description:
        "This scenario also uses the Mid-case base assumptions but anticipates 2.8% annual demand growth from 2024 to 2050, reaching 8,354 TWh/year by 2050, contrasting with 1.8% in the base assumptions.",
    },
    {
      title: "Low Natural Gas Prices",
      description:
        "This scenario retains the core assumptions of the Mid-case but applies the AEO2023 High Oil & Gas Resource/Technology case (U.S. EIA, 2023), in which prices begin at the 2025 Reference level and decline more sharply thereafter. By 2035, national average natural gas prices are projected to fall to approximately $2.50/MMBtu, compared to $3.50–$4.00/MMBtu in the Mid-case scenario.",
    },
    {
      title: "High Natural Gas Prices",
      description:
        "This scenario builds on the same foundational assumptions as the Mid-case but incorporates the AEO2023 Low Oil & Gas Resource/Technology case (U.S. EIA, 2023), which projects substantially higher natural gas prices over time. Prices start at the same level in 2025 but increase more rapidly, reaching over $6.00/MMBtu by 2035, compared to $3.50–$4.00/MMBtu in the Mid-case scenario, thereby enhancing the competitiveness of renewable energy and storage in the generation mix.",
    },
    {
      title: "Low Renewable Energy and Battery Costs with High Natural Gas Prices",
      description:
        " Building on the base assumptions of the Mid-case scenario, this case combines lower renewable energy and battery costs, based on the 2024 ATB advanced projections (NREL, 2024), which include wind adders dropping to $0/kW by 2050, with high natural gas prices, rising above $6.00/MMBtu by 2035. This combination creates one of the most favorable environments for renewable energy deployment among the eight modeled scenarios.",
    },
    {
      title: "High Renewable Energy and Battery Costs with Low Natural Gas Prices",
      description:
        "This scenario also builds on the same base assumptions as the first scenario but combines higher renewable energy and battery costs based on conservative ATB projections NREL, 2024), including a $200/kW capital cost adder for wind through 2050, with low natural gas prices, projected to reach around $2.50/MMBtu by 2035. This combination reduces the competitiveness of renewables and results in a slower decarbonization trajectory.",
    },
  ];

  const SCENARIO_NAMES = scenarios.map((s) => s.title);

  const GridEmissionState = useAppStore((state) => state.GridEmission);
  const setGridEmissionState = useAppStore((state) => state.setGridEmission);

  // Download handler removed: static image was replaced by live GridChartR3 chart.
  // TODO: Re-implement download by exporting the Chart.js canvas as PNG if needed.


  return (
    <div className="flex flex-col gap-6 pt-4 w-full max-w-6xl" style={{ marginLeft: '15%', marginRight: 'auto' }}>
      {/* Logo + Scenarios card */}
      <div className="flex flex-row items-start gap-4">
        <div className="shrink-0 pt-2">
          <img
            src={nrelLogo}
            alt="NREL Cambium"
            style={{ width: "160px", height: "auto" }}
          />
        </div>
        <Card variant="outlined" sx={{ backgroundColor: "#fafafa", mb: 4, maxWidth: 1200, px: 2, py: 1 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Scenarios
            </Typography>
            <Divider sx={{ my: 1 }} />
            <List>
              {scenarios.map(({ title, description }) => (
                <ListItem key={title} sx={{ display: "block", py: 1 }}>
                  <Typography variant="subtitle1" fontWeight="bold">
                    {title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {description}
                  </Typography>
                </ListItem>
              ))}
            </List>
          </CardContent>
        </Card>
      </div>
        <form className="flex items-end gap-4 p-4 rounded" style={{ marginLeft: 176 }}>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">
              Grid Emission Type
            </label>
            <select
              value={GridEmissionState.EmissionType}
              onChange={(e) =>
                setGridEmissionState({
                  EmissionType: e.target.value,
                })
              }
              className="border rounded px-2 py-1 w-65"
            >
              <option value="">Select Grid Emission Type</option>
              <option value="CO2">CO₂</option>
              <option value="N2O">N₂O</option>
              <option value="CH4">CH₄</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">City</label>
            <select
              value={classificationState.cityInput}
              disabled
              className="bg-gray-300 text-gray-600 rounded px-2 py-1 w-32"
            >
              <option value="">City</option>
              {statesList.slice(1).map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col justify-end">
            <button
              type="button"
              onClick={() => downloadR3CsvSingle(classificationState.cityInput, GridEmissionState.EmissionType)}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded px-5 py-2 text-sm font-semibold transition-colors"
            >
              DOWNLOAD
            </button>
          </div>
        </form>

        {/* Interactive GridChartR3 (user) + scenario legend below */}
        <div className="flex flex-col gap-4 w-full max-w-3xl" style={{ marginLeft: 176 }}>
          {/* Live chart */}
          <div className="rounded-lg bg-white shadow-sm p-3">
            <GridChartR3
              emissionType={GridEmissionState.EmissionType}
              cityName={classificationState.cityInput}
              showLegend={false}
              controlledIdx={selectedScenarioIdx}
              onSelect={setSelectedScenarioIdx}
            />
          </div>

          {/* Scenario legend — two columns in one box, same width as chart */}
          <div className="border border-gray-500 rounded-xl bg-white p-3 shadow-md w-full">
            {selectedScenarioIdx !== null && (
              <button type="button" onClick={() => setSelectedScenarioIdx(null)} className="text-[9px] text-blue-500 hover:text-blue-700 font-semibold mb-1">Clear</button>
            )}
            <div className="flex flex-row gap-6">
              {/* Column 1: short names */}
              <div className="flex flex-col gap-y-1">
                {[0, 2, 6, 7].map((idx) => {
                  const name = SCENARIO_NAMES[idx];
                  const isSelected = selectedScenarioIdx === idx;
                  const isFaded = selectedScenarioIdx !== null && !isSelected;
                  return (
                    <button key={name} type="button"
                      onClick={() => setSelectedScenarioIdx(selectedScenarioIdx === idx ? null : idx)}
                      className="flex items-center gap-1.5 py-0.5 hover:opacity-80 transition-opacity"
                      style={{ opacity: isFaded ? 0.28 : 1 }}>
                      <svg width="22" height="8" style={{ flexShrink: 0 }}>
                        <line x1="0" y1="4" x2="22" y2="4" stroke={SCENARIO_COLORS[idx % SCENARIO_COLORS.length]} strokeWidth={isSelected ? 2.5 : 1.5} strokeLinecap="round" />
                      </svg>
                      <span className={`text-[11px] text-left whitespace-nowrap ${isSelected ? "font-bold text-gray-900" : "font-bold text-gray-700"}`}>{name}</span>
                    </button>
                  );
                })}
              </div>
              {/* Column 2: includes both long combined-scenario names */}
              <div className="flex flex-col gap-y-1">
                {[1, 3, 4, 5].map((idx) => {
                  const name = SCENARIO_NAMES[idx];
                  const isSelected = selectedScenarioIdx === idx;
                  const isFaded = selectedScenarioIdx !== null && !isSelected;
                  return (
                    <button key={name} type="button"
                      onClick={() => setSelectedScenarioIdx(selectedScenarioIdx === idx ? null : idx)}
                      className="flex items-center gap-1.5 py-0.5 hover:opacity-80 transition-opacity"
                      style={{ opacity: isFaded ? 0.28 : 1 }}>
                      <svg width="22" height="8" style={{ flexShrink: 0 }}>
                        <line x1="0" y1="4" x2="22" y2="4" stroke={SCENARIO_COLORS[idx % SCENARIO_COLORS.length]} strokeWidth={isSelected ? 2.5 : 1.5} strokeLinecap="round" />
                      </svg>
                      <span className={`text-[11px] text-left whitespace-nowrap ${isSelected ? "font-bold text-gray-900" : "font-bold text-gray-700"}`}>{name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

    </div>
  );
};

export default GridEmissionRates;
