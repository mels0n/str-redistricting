import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import * as shapefile from 'shapefile';
import type { StateInfo } from '../../shared/apportionment/index.js';
import { CENSUS_SHA256 } from '../../shared/config/index.js';
import { DataError, DownloadError } from '../../shared/errors/index.js';
import { downloadCached, readZipEntry } from '../../shared/http/index.js';
import { countDistricts, legislativeFileName, legislativeUrl, type LegislativeChamber } from './count.js';

/** Every record's attributes from a legislative file's DBF. */
async function readRecords(zipPath: string, label: string): Promise<Record<string, unknown>[]> {
  const zip = new AdmZip(await readFile(zipPath));
  const source = await shapefile.openDbf(readZipEntry(zip, '.dbf', label));
  const records: Record<string, unknown>[] = [];
  for (;;) {
    const r = await source.read();
    if (r.done) break;
    records.push(r.value as Record<string, unknown>);
  }
  return records;
}

/** Whether the Census Bureau serves no file at all at `url` (HTTP 404), as it does for Nebraska's House. Any other failure is an error. */
export async function isAbsentUpstream(url: string, probe: (url: string) => Promise<unknown>): Promise<boolean> {
  try {
    await probe(url);
    return false;
  } catch (err) {
    if (err instanceof DownloadError && err.status === 404) return true;
    throw err;
  }
}

/**
 * The number of districts a state's chamber has, counted from its pinned Census file. A chamber with no pinned file
 * counts 0 only when `probe` shows the Census Bureau serves none; a file that exists but is not pinned is an error.
 * `manifest` is the pin list to read (the checked-in one by default; a command given another config directory passes its own).
 */
export async function countChamber(
  state: StateInfo,
  chamber: LegislativeChamber,
  vintage: number,
  cacheDir: string,
  probe: (url: string) => Promise<unknown>,
  manifest: Readonly<Record<string, string>> = CENSUS_SHA256,
): Promise<number> {
  const file = legislativeFileName(state, chamber, vintage);
  const label = `${state.abbr} ${chamber}`;
  const pinned = Object.hasOwn(manifest, `${file}.zip`) ? manifest[`${file}.zip`] : undefined;
  if (pinned === undefined) {
    if (await isAbsentUpstream(legislativeUrl(file), probe)) return 0;
    throw new DataError(`${label}: ${file}.zip is served but not pinned in config/census-sha256.json; run npm run legislative:pin`);
  }
  const path = await downloadCached(legislativeUrl(file), join(cacheDir, `${file}.zip`), label, pinned);
  return countDistricts(await readRecords(path, label), chamber);
}
