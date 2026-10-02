import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import * as shapefile from 'shapefile';
import type { Block } from '../../entities/census-block/index.js';
import type { StateInfo } from '../../shared/apportionment/index.js';
import { DataError } from '../../shared/errors/index.js';
import { downloadCached } from '../../shared/http/index.js';
import { parseBlockFeature } from './parse.js';

export const blocksUrl = (fips: string): string =>
  `https://www2.census.gov/geo/tiger/TIGER2020/TABBLOCK20/tl_2020_${fips}_tabblock20.zip`;

export async function ensureZip(state: StateInfo, cacheDir: string): Promise<string> {
  return downloadCached(blocksUrl(state.fips), join(cacheDir, `tl_2020_${state.fips}_tabblock20.zip`), state.abbr);
}

export async function loadStateBlocks(state: StateInfo, cacheDir: string): Promise<Block[]> {
  const zip = new AdmZip(await readFile(await ensureZip(state, cacheDir)));
  const entry = (ext: string) => {
    const e = zip.getEntries().find((x) => x.entryName.toLowerCase().endsWith(ext));
    if (!e) throw new DataError(`${state.abbr}: archive has no ${ext} file`);
    return e.getData();
  };
  const source = await shapefile.open(entry('.shp'), entry('.dbf'));
  const blocks: Block[] = [];
  for (;;) {
    const r = await source.read();
    if (r.done) break;
    blocks.push(parseBlockFeature(r.value.properties, r.value.geometry));
  }
  blocks.sort((a, b) => (a.geoid < b.geoid ? -1 : a.geoid > b.geoid ? 1 : 0));
  return blocks;
}
