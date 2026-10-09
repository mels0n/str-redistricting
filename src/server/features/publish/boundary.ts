import { join } from 'node:path';
import AdmZip from 'adm-zip';
import * as shapefile from 'shapefile';
import { z } from 'zod';
import { ENACTED_CONFIG, pinnedSha256 } from '../../shared/config/index.js';
import { DataError, DownloadError } from '../../shared/errors/index.js';
import { downloadCached, readZipEntry } from '../../shared/http/index.js';

/**
 * Census cartographic boundary files. They are drawn for display only (state outlines, county names,
 * today's enacted districts) and never feed the generator.
 */
const GENZ = 'https://www2.census.gov/geo/tiger';

export const STATES_FILE = 'cb_2025_us_state_20m';
/**
 * State land outlines clipped to the shoreline, at the 2020 vintage of the blocks. The generator's blocks run out to the
 * legal boundary (lakes, bays, coastal water); this file shows where the land stops. Display only.
 */
export const LAND_FILE = 'cb_2020_us_state_500k';
/** County names must match the 2020 block files the generator reads, so the 2020 vintage is used. */
export const COUNTIES_FILE = 'cb_2020_us_county_20m';
/**
 * The one Congress whose districts are shown for comparison, from config/enacted.json. The viewer reads the same
 * file, so the two cannot drift; `npm run enacted:bump` rewrites it.
 */
export const ENACTED_CONGRESS: number = ENACTED_CONFIG.congress;
/** Census vintages of that Congress's file, newest first; the first one the Census Bureau serves is the enacted source. */
export const ENACTED_CANDIDATES: readonly string[] = ENACTED_CONFIG.candidates;

export const boundaryUrl = (file: string): string => `${GENZ}/GENZ${file.slice(3, 7)}/shp/${file}.zip`;

const Fips2 = z.string().length(2);

export const StateRecord = z.object({ STATEFP: Fips2, STUSPS: z.string().length(2), NAME: z.string().min(1) });
export const CountyRecord = z.object({ STATEFP: Fips2, COUNTYFP: z.string().length(3), NAMELSAD: z.string().min(1) });
export interface CdRecord {
  readonly stateFp: string;
  /** District label as the Census Bureau publishes it, e.g. "Congressional District 3". */
  readonly label: string;
  /** Two-digit district code: "00" for an at-large state, "98" for a non-voting delegate. */
  readonly code: string;
}
const CdRaw = z.object({ STATEFP: Fips2, NAMELSAD: z.string().min(1) }).passthrough();

/** The district-code column is named for the Congress (CD119FP, CD118FP, ...), so find it by pattern. */
export function parseCdRecord(props: unknown): CdRecord {
  const base = CdRaw.parse(props);
  const key = Object.keys(base).find((k) => /^CD\d+FP$/.test(k));
  const code = z.string().length(2).parse(key === undefined ? undefined : base[key]);
  return { stateFp: base.STATEFP, label: base.NAMELSAD, code };
}

export interface RawFeature {
  readonly properties: unknown;
  readonly geometry: unknown;
}

export async function readBoundaryZip(zipPath: string, file: string): Promise<RawFeature[]> {
  const zip = new AdmZip(zipPath);
  const source = await shapefile.open(readZipEntry(zip, '.shp', file), readZipEntry(zip, '.dbf', file));
  const out: RawFeature[] = [];
  for (;;) {
    const r = await source.read();
    if (r.done) break;
    out.push({ properties: r.value.properties, geometry: r.value.geometry });
  }
  return out;
}

async function fetchBoundary(file: string, cacheDir: string): Promise<RawFeature[]> {
  const zip = await downloadCached(boundaryUrl(file), join(cacheDir, `${file}.zip`), file, pinnedSha256(`${file}.zip`));
  return readBoundaryZip(zip, file);
}

export interface StateOutline {
  readonly abbr: string;
  readonly name: string;
  readonly geometry: unknown;
}

export async function loadStates(cacheDir: string): Promise<StateOutline[]> {
  return (await fetchBoundary(STATES_FILE, cacheDir)).map((f) => {
    const r = StateRecord.parse(f.properties);
    return { abbr: r.STUSPS, name: r.NAME, geometry: f.geometry };
  });
}

/** Every state's land outline from the shoreline-clipped file, as geometries (neighbouring states included, so land borders leave no gap). */
export async function loadLand(cacheDir: string): Promise<unknown[]> {
  return (await fetchBoundary(LAND_FILE, cacheDir)).map((f) => f.geometry);
}

/** County FIPS (state + county, five digits) to county name. */
export async function loadCountyNames(cacheDir: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const f of await fetchBoundary(COUNTIES_FILE, cacheDir)) {
    const c = CountyRecord.parse(f.properties);
    names.set(c.STATEFP + c.COUNTYFP, c.NAMELSAD);
  }
  return names;
}

export interface EnactedFile {
  readonly source: string;
  readonly features: { record: CdRecord; geometry: unknown }[];
}

/** All enacted districts of the pinned Congress. Never falls back to another Congress: if no vintage is served, publishing fails. */
export async function loadEnacted(cacheDir: string): Promise<EnactedFile> {
  for (const source of ENACTED_CANDIDATES) {
    try {
      const features = (await fetchBoundary(source, cacheDir)).map((f) => ({ record: parseCdRecord(f.properties), geometry: f.geometry }));
      return { source, features };
    } catch (err) {
      if (!(err instanceof DownloadError && err.status === 404)) throw err;
    }
  }
  throw new DataError(`no enacted-district file for Congress ${ENACTED_CONGRESS} available (tried ${ENACTED_CANDIDATES.join(', ')})`);
}
