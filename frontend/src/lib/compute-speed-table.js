// Dynamic speed computation (auto-detects headers)
import { speedFromGreenshields } from "./mfd.js";

function findByRegex(headers, patterns) {
  return (headers || []).findIndex((h) =>
    patterns.some((re) => re.test(String(h || "").trim().toLowerCase()))
  );
}

export function buildSpeedTable(volHeaders, volRows, mfdHeaders, mfdRows) {
  const vh = volHeaders || [];
  const mh = mfdHeaders || [];

  const vTractIdx = findByRegex(vh, [/tract/]);
  const vHourIdx  = findByRegex(vh, [/hour|time/]);
  const vVolIdx   = findByRegex(vh, [/volume|flow|q/]);

  const mTractIdx = findByRegex(mh, [/tract/]);
  const mUfIdx    = findByRegex(mh, [/u[_\s]?f|free\s*flow/]);
  const mKjIdx    = findByRegex(mh, [/k[_\s]?j|jam/]);

  if ([vTractIdx, vVolIdx, mTractIdx, mUfIdx, mKjIdx].some((i) => i < 0)) return [];

  const mfdByTract = new Map();
  for (const r of mfdRows || []) {
    const tract = r?.[mTractIdx];
    if (tract != null) mfdByTract.set(String(tract), r);
  }

  const out = [];
  for (const r of volRows || []) {
    const tract = r?.[vTractIdx];
    const q = Number(r?.[vVolIdx]);
    if (!tract || !Number.isFinite(q)) continue;

    const mfd = mfdByTract.get(String(tract));
    if (!mfd) continue;

    const uf = Number(mfd?.[mUfIdx]);
    const kj = Number(mfd?.[mKjIdx]);
    const res = speedFromGreenshields(q, uf, kj);
    if (!res) continue;

    out.push({
      tract: String(tract),
      hour: vHourIdx >= 0 ? r?.[vHourIdx] : null,
      volume: q,
      uf,
      kj,
      speed: res.speed,
      density: res.density,
    });
  }
  return out;
}

export function volumeWeightedAvgSpeed(speedTable) {
  let wsum = 0, vsum = 0;
  for (const r of speedTable || []) {
    if (Number.isFinite(r.speed) && Number.isFinite(r.volume)) {
      wsum += r.speed * r.volume;
      vsum += r.volume;
    }
  }
  return vsum > 0 ? wsum / vsum : null;
}
