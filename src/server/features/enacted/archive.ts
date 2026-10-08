import { STATES } from '../../shared/apportionment/index.js';
import { DataError } from '../../shared/errors/index.js';
import { parseCdRecord, readBoundaryZip, type RawFeature } from '../publish/index.js';

/** Throws unless `features` hold districts for every state. */
export function checkCoverage(features: readonly RawFeature[], file: string): void {
  const fips = new Set(features.map((f) => parseCdRecord(f.properties).stateFp));
  const missing = STATES.filter((s) => !fips.has(s.fips)).map((s) => s.abbr);
  if (missing.length > 0) throw new DataError(`${file}: no districts for ${missing.join(', ')}; refusing to adopt it`);
}

/** The archive must parse and hold districts for every state, or it is not pinned. */
export async function checkArchive(zip: string, file: string): Promise<void> {
  checkCoverage(await readBoundaryZip(zip, file), file);
}
