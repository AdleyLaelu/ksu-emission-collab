import type { ModelKey } from '../cityModel';

export async function sendCitySelection(
  city: string,
  models: ModelKey[],
  extraFeatures: Record<string, any> = {}
) {
  const res = await fetch('/predict/by-model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      city,
      models,
      features: { city, ...extraFeatures }
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}
