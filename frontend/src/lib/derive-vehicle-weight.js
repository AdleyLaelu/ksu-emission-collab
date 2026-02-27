export function deriveVehicleWeightFromTable({ headers, rows, vehicleType }) {
  if (!headers?.length || !rows?.length || !vehicleType) return null;

  const H = headers.map((h) => String(h || "").trim().toLowerCase());
  const vtIdx = H.findIndex((h) => /vehicle\s*type|class|vtype/.test(h));
  const wIdx  = H.findIndex((h) => /(weight|mass)(\s*\(kg\)|_kg)?/.test(h));

  if (vtIdx < 0 || wIdx < 0) return null;

  const norm = (s) => String(s || "").trim().toLowerCase();
  let sum = 0, n = 0;
  for (const r of rows) {
    if (norm(r?.[vtIdx]) === norm(vehicleType)) {
      const w = Number(r?.[wIdx]);
      if (Number.isFinite(w) && w > 0) { sum += w; n++; }
    }
  }
  return n > 0 ? sum / n : null;
}
