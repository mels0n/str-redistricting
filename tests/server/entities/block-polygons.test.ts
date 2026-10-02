import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadBlockPolygons, loadStateBlocks } from '../../../src/server/entities/census-block/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';

const ri = { abbr: 'RI', fips: '44', name: 'Rhode Island', seats: 2 };
const cached = existsSync('data/raw/tl_2020_44_tabblock20.zip');

describe.skipIf(!cached)('loadBlockPolygons (cached Rhode Island TIGER file)', () => {
  it('returns the polygons of just the requested blocks, matching the full loader', async () => {
    const blocks = await loadStateBlocks(ri, 'data/raw');
    const want = [blocks[0]!, blocks[blocks.length - 1]!];
    const got = await loadBlockPolygons(ri, 'data/raw', new Set(want.map((b) => b.geoid)));
    expect([...got.keys()].sort()).toEqual(want.map((b) => b.geoid).sort());
    for (const b of want) expect(got.get(b.geoid)!.flat()).toEqual(b.rings);
  });
  it('rejects a GEOID that is not in the file', async () => {
    await expect(loadBlockPolygons(ri, 'data/raw', new Set(['449999999999999']))).rejects.toThrow(DataError);
  });
});
