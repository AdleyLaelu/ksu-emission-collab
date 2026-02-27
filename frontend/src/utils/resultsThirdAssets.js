// Vite: import all R2 images from assets/ResultsOne
const modules = import.meta.glob("../assets/ResultsThree/*_R3.{png,jpg,jpeg}", {
  eager: true,
  import: "default",
});

// --- Normalizers -------------------------------------------------------------
const EMISSION_ALIAS = {
  co2: "CO2",
  n2o: "N2O",
  ch4: "CH4",
};


const normToken = (s, aliasMap) =>
  aliasMap[String(s || "").trim().toLowerCase()] ??
  // fallback: strip spaces to match file token
  String(s || "").trim().replace(/\s+/g, "");

const normEmission = (s) => normToken(s, EMISSION_ALIAS);

const normCity = (s) =>
  String(s || "")
    .trim()
    .replace(/[\s_]+/g, "")   // "Los Angeles" or "Los_Angeles" -> "LosAngeles"
    .replace(/[^A-Za-z0-9]/g, "");

// --- Keys --------------------------------------------------------------------
const emissionKey = (emission, city) =>
  `${normEmission(emission)}_${normCity(city)}_R3`;


// --- Build two maps: one for emission images, one for fuel images ------------
const EMISSION_SET = new Set(
  Object.values(EMISSION_ALIAS).concat(["CO2", "N2O", "CH4"])
);

const EMISSION_MAP = {};

for (const [path, url] of Object.entries(modules)) {
  const file = path.split("/").pop();                  // e.g., "CO2_Los_Angeles_R2.png"
  if (!file) continue;
  const base = file.replace(/\.(png|jpe?g)$/i, "");    // strip extension

  // Expect "<Token>_<City>_R1"
  const m = base.match(/^(.+)_([^_]+(?:_[^_]+)*)_R3$/);
  // m[1] = token (Fuel or Emission), m[2] = city with underscores if any
  if (!m) continue;

  const tokenRaw = m[1];
  const cityRaw = m[2];

  const tokenNormForEmission = normEmission(tokenRaw);
  const cityNorm = normCity(cityRaw);

  // Classify into EMISSION_MAP or FUEL_MAP by comparing against sets
  if (EMISSION_SET.has(tokenNormForEmission)) {
    EMISSION_MAP[`${tokenNormForEmission}_${cityNorm}_R3`] = url;
  }

  // If a token appears in neither set, you can log once to adjust aliases:
  // else { console.warn("Unclassified token:", tokenRaw, "in file:", file); }
}

// --- Public helpers ----------------------------------------------------------
export function getR3EmissionImgUrl(emissionType, cityName) {
  return EMISSION_MAP[emissionKey(emissionType, cityName)];
}

export function buildR3FileNameFromEmission(emissionType, cityName, url) {
  const base = emissionKey(emissionType, cityName);
  const ext = (url && (url.match(/\.(png|jpe?g)(\?.*)?$/i)?.[1] || "png")) || "png";
  return `${base}.${ext.toLowerCase()}`;
}

