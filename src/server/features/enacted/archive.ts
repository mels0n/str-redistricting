import { STATES } from '../../shared/apportionment/index.js';
import { DataError } from '../../shared/errors/index.js';

/**
 * A new enacted-districts archive is adopted only if it holds districts for every state. `stateFips` are the state
 * codes of the archive's district records (the caller reads the archive; slices do not import one another).
 */
export function checkCoverage(stateFips: Iterable<string>, file: string): void {
  const fips = new Set(stateFips);
  const missing = STATES.filter((s) => !fips.has(s.fips)).map((s) => s.abbr);
  if (missing.length > 0) throw new DataError(`${file}: no districts for ${missing.join(', ')}; refusing to adopt it`);
}
