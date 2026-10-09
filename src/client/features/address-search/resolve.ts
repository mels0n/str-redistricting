import { findState, stateFromFips, isGenerated, type GeneratedState, type StateEntry, type StateIndex } from '../../entities/state';
import type { GeocodeResult } from './geocode';

/** What an address answer means for the page the visitor is on. */
export type Resolution =
  | { kind: 'here' }
  | { kind: 'open'; state: GeneratedState }
  | { kind: 'no-map'; state: StateEntry }
  | { kind: 'outside' };

/** The state an answer belongs to: the census block's state when known, else the reported one. */
export function stateFromBlock(result: GeocodeResult): string {
  return (result.block !== null ? stateFromFips(result.block.slice(0, 2)) : null) ?? result.state;
}

/**
 * Decides where a found address belongs. `currentAbbr` is the state page the
 * visitor is on, or null on the national page.
 */
export function resolveAddress(index: StateIndex, result: GeocodeResult, currentAbbr: string | null): Resolution {
  const abbr = stateFromBlock(result);
  if (currentAbbr !== null && abbr === currentAbbr) return { kind: 'here' };
  const state = findState(index, abbr);
  if (!state) return { kind: 'outside' };
  if (!isGenerated(state)) return { kind: 'no-map', state };
  return { kind: 'open', state };
}

/** The sentence shown under the search field for any resolution that does not stay on the page. */
export function describeResolution(res: Exclude<Resolution, { kind: 'here' }>, result: GeocodeResult): string {
  switch (res.kind) {
    case 'outside':
      return `${result.matchedAddress} is not in one of the 50 states, so there is no map for it here. Washington, D.C. and the U.S. territories elect non-voting delegates to the House, so they have no districts to draw.`;
    case 'no-map':
      return `${result.matchedAddress} is in ${res.state.name}. The map for ${res.state.name} has not been generated.`;
    case 'open':
      return `Found ${result.matchedAddress}. Opening ${res.state.name}.`;
  }
}

/** Added to the message when the Census Bureau returned more than one match. */
export function describeMultipleMatches(count: number): string {
  return count > 1 ? ` The Census Bureau found ${count} possible matches and this is the first. Add the city, state or ZIP code to narrow it.` : '';
}
