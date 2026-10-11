import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { countChamber } from '../entities/legislative-boundary/index.js';
import { probeSource } from '../features/census-watch/index.js';
import { STATES } from '../shared/apportionment/index.js';
import { ENACTED_CONFIG, LegislativeDistrictsSchema, type LegislativeDistricts } from '../shared/config/index.js';

export const COUNTS_FILE = 'legislative-districts.json';

/** The counts for every state, each read from its pinned Census files. */
export async function countAll(cacheDir: string): Promise<LegislativeDistricts> {
  const vintage = ENACTED_CONFIG.legislative.vintage;
  const states: LegislativeDistricts['states'] = {};
  for (const state of STATES) {
    const [house, senate] = await Promise.all([
      countChamber(state, 'state-house', vintage, cacheDir, probeSource),
      countChamber(state, 'state-senate', vintage, cacheDir, probeSource),
    ]);
    states[state.abbr] = { 'state-house': house, 'state-senate': senate };
  }
  return LegislativeDistrictsSchema.parse({ vintage, states });
}

/** The exact layout of the counts file: one state per line. */
export function formatCounts(c: LegislativeDistricts): string {
  const rows = Object.entries(c.states)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([abbr, n]) => `    ${JSON.stringify(abbr)}: { "state-house": ${n['state-house']}, "state-senate": ${n['state-senate']} }`);
  return `{\n  "vintage": ${c.vintage},\n  "states": {\n${rows.join(',\n')}\n  }\n}\n`;
}

export const countsPath = (configDir: string): string => join(configDir, COUNTS_FILE);

export async function readCountsText(configDir: string): Promise<string | undefined> {
  try {
    return (await readFile(countsPath(configDir), 'utf8')).replace(/^\uFEFF/, '');
  } catch {
    return undefined;
  }
}

export const writeCounts = (configDir: string, c: LegislativeDistricts): Promise<void> => writeFile(countsPath(configDir), formatCounts(c), 'utf8');
