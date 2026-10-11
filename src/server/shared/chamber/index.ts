import { z } from 'zod';
import type { StateInfo } from '../apportionment/index.js';
import { legislativeDistricts, type LegislativeDistricts } from '../config/legislative-districts.js';
import { ConfigError, DataError } from '../errors/index.js';

/** A body whose districts are drawn: the US House (the default) or a state's House or Senate. */
export type Chamber = 'federal-house' | 'state-house' | 'state-senate';
export const CHAMBERS: readonly Chamber[] = ['federal-house', 'state-house', 'state-senate'];
export const ChamberSchema = z.enum(['federal-house', 'state-house', 'state-senate']);

/** Read once at the command line; anything else is a ConfigError. */
export function parseChamber(s: string): Chamber {
  const parsed = ChamberSchema.safeParse(s);
  if (!parsed.success) throw new ConfigError(`unknown chamber: ${s} (expected ${CHAMBERS.join(', ')})`);
  return parsed.data;
}

/** A state's folder for a chamber under out/ and public/data/, with `/` separators; callers join it. Federal keeps the state folder itself. */
export function planDir(abbr: string, chamber: Chamber): string {
  return chamber === 'federal-house' ? abbr : `${abbr}/${chamber}`;
}

/** Districts in a chamber: the apportioned seats for the Federal House, the Census district count otherwise (0 when the state has no such chamber). */
export function seatsFor(state: StateInfo, chamber: Chamber, table?: LegislativeDistricts): number {
  // The counts file is read only for a state chamber, so Federal House runs never open it.
  if (chamber === 'federal-house') return state.seats;
  const entry = (table ?? legislativeDistricts()).states[state.abbr];
  if (entry === undefined) throw new DataError(`no ${chamber} district count for ${state.abbr} in config/legislative-districts.json`);
  return entry[chamber];
}

/** The same state with the chamber's district count as its seats, so everything that reads `state.seats` works unchanged. */
export function stateForChamber(state: StateInfo, chamber: Chamber, table?: LegislativeDistricts): StateInfo {
  return { ...state, seats: seatsFor(state, chamber, table) };
}
