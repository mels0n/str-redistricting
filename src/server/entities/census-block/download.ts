import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import * as shapefile from 'shapefile';
import type { Block } from './model.js';
import type { StateInfo } from '../../shared/apportionment/index.js';
import { pinnedSha256 } from '../../shared/config/index.js';
import { DataError } from '../../shared/errors/index.js';
import { downloadCached } from '../../shared/http/index.js';
import { parseBlockFeature, parseBlockPolygons, type BlockPolygons } from './parse.js';

export const blocksUrl = (fips: string): string =>
  `https://www2.census.gov/geo/tiger/TIGER2020/TABBLOCK20/tl_2020_${fips}_tabblock20.zip`;

export async function ensureZip(state: StateInfo, cacheDir: string): Promise<string> {
  const file = `tl_2020_${state.fips}_tabblock20.zip`;
  return downloadCached(blocksUrl(state.fips), join(cacheDir, file), state.abbr, pinnedSha256(file));
}

async function openBlockSource(state: StateInfo, cacheDir: string) {
  const zip = new AdmZip(await readFile(await ensureZip(state, cacheDir)));
  const entry = (ext: string) => {
    const e = zip.getEntries().find((x) => x.entryName.toLowerCase().endsWith(ext));
    if (!e) throw new DataError(`${state.abbr}: archive has no ${ext} file`);
    return e.getData();
  };
  return shapefile.open(entry('.shp'), entry('.dbf'));
}

export async function loadStateBlocks(state: StateInfo, cacheDir: string): Promise<Block[]> {
  const source = await openBlockSource(state, cacheDir);
  const blocks: Block[] = [];
  for (;;) {
    const r = await source.read();
    if (r.done) break;
    blocks.push(parseBlockFeature(r.value.properties, r.value.geometry));
  }
  blocks.sort((a, b) => (a.geoid < b.geoid ? -1 : a.geoid > b.geoid ? 1 : 0));
  return blocks;
}

/** Polygons of just the blocks with the given GEOIDs, read from the cached TIGER file (other blocks are skipped unparsed). */
export async function loadBlockPolygons(state: StateInfo, cacheDir: string, geoids: ReadonlySet<string>): Promise<Map<string, BlockPolygons>> {
  const source = await openBlockSource(state, cacheDir);
  const found = new Map<string, BlockPolygons>();
  while (found.size < geoids.size) {
    const r = await source.read();
    if (r.done) break;
    const geoid = (r.value.properties as { GEOID20?: unknown } | null)?.GEOID20;
    if (typeof geoid !== 'string' || !geoids.has(geoid)) continue;
    found.set(geoid, parseBlockPolygons(r.value.geometry, geoid));
  }
  const missing = [...geoids].filter((g) => !found.has(g));
  if (missing.length > 0) throw new DataError(`${state.abbr}: ${missing.length} moved blocks not in the TIGER file (first ${missing[0]})`);
  return found;
}
