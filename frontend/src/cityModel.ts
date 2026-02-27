export type City = 'ca' | 'ga' | 'ny' | 'wa';
export type ModelKey = 'co2' | 'energy' | 'nox' | 'brake' | 'tire';

export const CITY_TO_MODELS: Record<City, ModelKey[]> = {
  ca: ['co2'],          // CA → CO2
  ga: ['energy'],       // GA → ENERGY
  ny: ['nox'],          // NY → NOX
  wa: ['brake', 'tire'] // WA → BRAKE & TIRE
};
