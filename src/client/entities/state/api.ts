import { dataUrl, fetchJson } from '../../shared';
import { StateIndexSchema, type StateIndex } from './model';

let index: Promise<StateIndex> | null = null;

/** The list of all 50 states, with a summary for each generated map. */
export function loadIndex(): Promise<StateIndex> {
  if (!index) {
    index = fetchJson(dataUrl('index.json'), StateIndexSchema);
    index.catch(() => {
      index = null;
    });
  }
  return index;
}
