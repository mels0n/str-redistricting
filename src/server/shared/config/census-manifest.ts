import { z } from 'zod';
import manifestJson from '../../../../config/census-sha256.json' with { type: 'json' };
import { DataError } from '../errors/index.js';

/**
 * Pinned SHA-256 of every Census Bureau file the generator and the publish step read, keyed by file name
 * (config/census-sha256.json). The maps are only reproducible from these exact bytes. The tabblock files are the
 * 2020 TIGER block shapefiles for the 50 states; the cb_ files are the display-only cartographic boundaries. The
 * Census Bureau can reissue a file without notice, so a mismatch means the maps would change: do not edit a value
 * there without regenerating and re-reviewing every map that reads the file.
 */
export const ManifestSchema = z.record(z.string().min(1), z.string().regex(/^[0-9a-f]{64}$/));

export const CENSUS_SHA256: Readonly<Record<string, string>> = ManifestSchema.parse(manifestJson);

/** The pinned hash for `fileName`, or a DataError when the file is not in the manifest (never a silent pass). */
export function pinnedSha256(fileName: string): string {
  const pinned = Object.hasOwn(CENSUS_SHA256, fileName) ? CENSUS_SHA256[fileName] : undefined;
  if (pinned === undefined) {
    throw new DataError(`${fileName}: not in the pinned Census manifest (config/census-sha256.json), so its sha256 cannot be checked`);
  }
  return pinned;
}
