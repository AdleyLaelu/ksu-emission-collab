/** Shared R3 (Grid) data map and CSV download helpers. */

import { CITY_TO_STATE } from "./chartConstants";

import GA_CO2 from "../assets/r3data/GA_CO2.json";
import GA_CH4 from "../assets/r3data/GA_CH4.json";
import GA_N2O from "../assets/r3data/GA_N2O.json";
import CA_CO2 from "../assets/r3data/CA_CO2.json";
import CA_CH4 from "../assets/r3data/CA_CH4.json";
import CA_N2O from "../assets/r3data/CA_N2O.json";
import NY_CO2 from "../assets/r3data/NY_CO2.json";
import NY_CH4 from "../assets/r3data/NY_CH4.json";
import NY_N2O from "../assets/r3data/NY_N2O.json";
import WA_CO2 from "../assets/r3data/WA_CO2.json";
import WA_CH4 from "../assets/r3data/WA_CH4.json";
import WA_N2O from "../assets/r3data/WA_N2O.json";

export const R3_DATA_MAP = {
  GA_CO2, GA_CH4, GA_N2O,
  CA_CO2, CA_CH4, CA_N2O,
  NY_CO2, NY_CH4, NY_N2O,
  WA_CO2, WA_CH4, WA_N2O,
};

function resolveState(cityName) {
  return CITY_TO_STATE[cityName] || CITY_TO_STATE[cityName?.replace(/\s/g, "")] || null;
}

function triggerDownload(csv, filename) {
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Download CSV for a single gas type (used on the Analysis page). */
export function downloadR3CsvSingle(cityName, emissionType) {
  const state = resolveState(cityName);
  if (!state || !emissionType) return;
  const json = R3_DATA_MAP[`${state}_${emissionType}`];
  if (!json) return;
  const scenarioNames = Object.keys(json.scenarios);
  const dates = json.scenarios[scenarioNames[0]].map((p) => p.date.replace(/\s+00:00:00$/, ""));
  const header = ["Date", ...scenarioNames];
  const rows = dates.map((date, i) => [
    date,
    ...scenarioNames.map((s) => json.scenarios[s]?.[i]?.value ?? ""),
  ]);
  const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
  triggerDownload(csv, `${cityName}_${emissionType}_grid_emissions.csv`);
}

/** Download CSV for all three gases combined (used on the Results page). */
export function downloadR3CsvAll(cityName) {
  const state = resolveState(cityName);
  if (!state) return;
  const gases = ["CO2", "CH4", "N2O"];
  const allData = gases.map((gas) => {
    const json = R3_DATA_MAP[`${state}_${gas}`];
    if (!json) return null;
    return { gas, scenarios: json.scenarios };
  }).filter(Boolean);
  if (!allData.length) return;
  const scenarioNames = Object.keys(allData[0].scenarios);
  const dates = allData[0].scenarios[scenarioNames[0]].map((p) => p.date.replace(/\s+00:00:00$/, ""));
  const header = ["Date", ...allData.flatMap((d) => scenarioNames.map((s) => `${d.gas}_${s}`))];
  const rows = dates.map((date, i) => [
    date,
    ...allData.flatMap((d) => scenarioNames.map((s) => d.scenarios[s]?.[i]?.value ?? "")),
  ]);
  const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
  triggerDownload(csv, `${cityName}_Grid_emissions.csv`);
}
