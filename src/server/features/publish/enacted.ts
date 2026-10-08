import type { StateInfo } from '../../shared/apportionment/index.js';
import { DataError } from '../../shared/errors/index.js';
import { crossesAntimeridian, unwrapFeatures } from './antimeridian.js';
import type { EnactedFile } from './boundary.js';
import { districtBudget, toTopology } from './topo.js';

/** The state's enacted districts as the simplified, display-framed TopoJSON that goes into `enacted.topo.json`. */
export async function buildEnactedTopology(state: StateInfo, enacted: EnactedFile): Promise<string> {
  const features = enacted.features
    .filter((f) => f.record.stateFp === state.fips)
    .sort((a, b) => a.record.code.localeCompare(b.record.code))
    .map((f) => ({ type: 'Feature', properties: { label: f.record.label, code: f.record.code }, geometry: f.geometry as { coordinates?: unknown } }));
  if (features.length === 0) throw new DataError(`${state.abbr}: no enacted districts in ${enacted.source}`);
  const shown = crossesAntimeridian(state.abbr) ? unwrapFeatures(features) : features;
  return toTopology({ features: shown }, 'enacted', districtBudget(state.seats));
}
