// Vite: import all analysis images
const modules = import.meta.glob("../assets/Analysis/*_Analysis.{png,jpg,jpeg}", {
  eager: true,
  import: "default",
});

const EMISSION_ALIAS = { co2: "CO2", n2o: "N2O", ch4: "CH4" };

const normEmission = s =>
  EMISSION_ALIAS[String(s||"").trim().toLowerCase()] ??
  String(s||"").replace(/\s+/g, "");

const normCity = s =>
  String(s||"")
    .trim()
    .replace(/[\s_]+/g, "")     // "Los Angeles" or "Los_Angeles" -> "LosAngeles"
    .replace(/[^A-Za-z0-9]/g, "");

export const analysisKey = (emission, city) =>
  `${normEmission(emission)}_${normCity(city)}_Analysis`;

// Build a normalized map { "CO2_Atlanta_Analysis": "/assets/CO2_Atlanta_Analysis.xxxx.png", ... }
const ANALYSIS_MAP = {};
for (const [path, url] of Object.entries(modules)) {
  const file = path.split("/").pop();                        // e.g., "CO2_Los_Angeles_Analysis.png"
  if (!file) continue;
  const base = file.replace(/\.(png|jpe?g)$/i, "");          // strip extension
  const m = base.match(/^([^_]+)_(.+)_Analysis$/);           // emission + city (city may contain underscores)
  if (!m) continue;
  const emissionPart = m[1], cityRaw = m[2];
  ANALYSIS_MAP[analysisKey(emissionPart, cityRaw)] = url;
}

export function getAnalysisImgUrl(emission, city) {
  return ANALYSIS_MAP[analysisKey(emission, city)];
}

export function buildAnalysisFileName(emission, city, url) {
  const base = analysisKey(emission, city);
  const ext = (url && (url.match(/\.(png|jpe?g)(\?.*)?$/i)?.[1] || "png")) || "png";
  return `${base}.${ext.toLowerCase()}`;
}
