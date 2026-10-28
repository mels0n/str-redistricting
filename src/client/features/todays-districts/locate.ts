import { pointInGeometry, districtKey, type LonLat, type Office } from '../../shared';
import { loadEnacted } from '../../entities/plan';
import { STATEWIDE_CODE, type Rep, type StateReps } from '../../entities/reps';

/** The enacted district codes at one place; null where the chamber has no file or no district there. */
export interface TodaysDistricts {
  state: string;
  usHouse: string | null;
  stateHouse: string | null;
  stateSenate: string | null;
}

export interface RepsRow {
  office: Office;
  key: string;
  reps: Rep[];
  /** True when the district is known but the published reps have no entry for it. */
  missing: boolean;
}

/** The code of the enacted district containing the point; on an exact border the lowest code wins. A missing file gives null. */
async function codeAt(state: string, chamber: 'federal-house' | 'state-house' | 'state-senate', lonLat: LonLat): Promise<string | null> {
  let shapes;
  try {
    shapes = await loadEnacted(state, chamber);
  } catch {
    return null;
  }
  const codes = shapes.features.filter((f) => pointInGeometry(lonLat, f.geometry)).map((f) => f.properties.code);
  codes.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  return codes[0] ?? null;
}

/** The districts in force today (the enacted maps) at a point in a state. */
export async function todaysDistrictsAt(state: string, lonLat: LonLat): Promise<TodaysDistricts> {
  const [usHouse, stateHouse, stateSenate] = await Promise.all([
    codeAt(state, 'federal-house', lonLat),
    codeAt(state, 'state-house', lonLat),
    codeAt(state, 'state-senate', lonLat),
  ]);
  return { state, usHouse, stateHouse, stateSenate };
}

/** The representatives for each seat at the place: state senate, state house, US House, US Senate. */
export function repsFor(reps: StateReps, d: TodaysDistricts): RepsRow[] {
  const rows: RepsRow[] = [];
  const add = (office: Office, code: string | null): void => {
    if (code === null) return;
    const key = districtKey(d.state, office, code);
    const found = reps.byKey[key];
    rows.push({ office, key, reps: found ?? [], missing: found === undefined });
  };
  add('state-senate', d.stateSenate);
  add('state-house', d.stateHouse);
  add('us-house', d.usHouse);
  add('us-senate', STATEWIDE_CODE);
  return rows;
}
