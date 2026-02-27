// Vite: import all R2 images from assets/ResultsOne
const modules = import.meta.glob("../assets/ResultsTwo/*_R2.{svg,jpg,jpeg}", {
  eager: true,
  import: "default",
});

// --- Normalizers -------------------------------------------------------------
const EMISSION_ALIAS = {
  co2: "CO2",
  n2o: "N2O",
  ch4: "CH4",
  // if you have more in folder (NOX, PM2.5B, PM2.5T), add:
  nox: "NOX",
  "pm2.5b": "PM25B",
  "pm2.5t": "PM25T"
};

const FUEL_ALIAS = {
  gasoline: "Gasoline",
  diesel: "Diesel",
  ethanol: "Ethanol",
  cng: "CNG",
  electricity: "Electricity",
};

const normToken = (s, aliasMap) =>
  aliasMap[String(s || "").trim().toLowerCase()] ??
  // fallback: strip spaces to match file token
  String(s || "").trim().replace(/\s+/g, "");

const normEmission = (s) => normToken(s, EMISSION_ALIAS);
const normFuel = (s) => normToken(s, FUEL_ALIAS);

const normCity = (s) =>
  String(s || "")
    .trim()
    .replace(/[\s_]+/g, "")   // "Los Angeles" or "Los_Angeles" -> "LosAngeles"
    .replace(/[^A-Za-z0-9]/g, "");

// --- Keys --------------------------------------------------------------------
const emissionKey = (emission, city) =>
  `${normEmission(emission)}_${normCity(city)}_R1`;

const fuelKey = (fuel, city) =>
  `${normFuel(fuel)}_${normCity(city)}_R1`;

// --- Build two maps: one for emission images, one for fuel images ------------
const EMISSION_SET = new Set(
  Object.values(EMISSION_ALIAS).concat(["CO2", "N2O", "CH4", "NOX", "PM25B", "PM25T"])
);
const FUEL_SET = new Set(
  Object.values(FUEL_ALIAS).concat(["Gasoline", "Diesel", "Ethanol", "CNG", "Electricity"])
);

const EMISSION_MAP = {};
const FUEL_MAP = {};

for (const [path, url] of Object.entries(modules)) {
  const file = path.split("/").pop();                  // e.g., "CO2_Los_Angeles_R2.svg"
  if (!file) continue;
  const base = file.replace(/\.(svg|jpe?g)$/i, "");    // strip extension

  // Expect "<Token>_<City>_R1"
  const m = base.match(/^(.+)_([^_]+(?:_[^_]+)*)_R2$/);
  // m[1] = token (Fuel or Emission), m[2] = city with underscores if any
  if (!m) continue;

  const tokenRaw = m[1];
  const cityRaw = m[2];

  const tokenNormForEmission = normEmission(tokenRaw);
  const tokenNormForFuel = normFuel(tokenRaw);
  const cityNorm = normCity(cityRaw);

  // Classify into EMISSION_MAP or FUEL_MAP by comparing against sets
  if (EMISSION_SET.has(tokenNormForEmission)) {
    EMISSION_MAP[`${tokenNormForEmission}_${cityNorm}_R1`] = url;
  }
  if (FUEL_SET.has(tokenNormForFuel)) {
    FUEL_MAP[`${tokenNormForFuel}_${cityNorm}_R1`] = url;
  }

  // If a token appears in neither set, you can log once to adjust aliases:
  // else { console.warn("Unclassified token:", tokenRaw, "in file:", file); }
}

// --- Public helpers ----------------------------------------------------------
export function getR2EmissionImgUrl(emissionType, cityName) {
  return EMISSION_MAP[emissionKey(emissionType, cityName)];
}

export function getR2FuelImgUrl(fuelType, cityName) {
  return FUEL_MAP[fuelKey(fuelType, cityName)];
}

export function buildR2FileNameFromEmission(emissionType, cityName, url) {
  const base = emissionKey(emissionType, cityName);
  const ext = (url && (url.match(/\.(svg|jpe?g)(\?.*)?$/i)?.[1] || "svg")) || "svg";
  return `${base}.${ext.toLowerCase()}`;
}

export function buildR2FileNameFromFuel(fuelType, cityName, url) {
  const base = fuelKey(fuelType, cityName);
  const ext = (url && (url.match(/\.(svg|jpe?g)(\?.*)?$/i)?.[1] || "svg")) || "svg";
  return `${base}.${ext.toLowerCase()}`;
}

// (Optional) debug once:
// console.log("EMISSION keys:", Object.keys(EMISSION_MAP));
// console.log("FUEL keys:", Object.keys(FUEL_MAP));
