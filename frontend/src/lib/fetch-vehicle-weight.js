export async function fetchVehicleWeightFromModel(API_BASE, vehicleType) {
  if (!vehicleType) return null;
  const res = await fetch(`${API_BASE}/meta/vehicle-weight?type=${encodeURIComponent(vehicleType)}`);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const w = Number(data?.weight_kg);
  return Number.isFinite(w) && w > 0 ? w : null;
}
