import { dataUrl, fetchJson } from '../../shared';
import { StateRepsSchema, type StateReps } from './model';

const loads = new Map<string, Promise<StateReps>>();

/** Every representative of a state, validated, fetched once per state. */
export function loadStateReps(state: string): Promise<StateReps> {
  let p = loads.get(state);
  if (!p) {
    p = fetchJson(dataUrl(`reps/${state}.json`), StateRepsSchema);
    p.catch(() => loads.delete(state));
    loads.set(state, p);
  }
  return p;
}
