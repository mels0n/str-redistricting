import { existsSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTopology, loadStateBlocks, type Block } from '../../../src/server/entities/census-block/index.js';
import { createContext, findCut, ScanPool, splitState } from '../../../src/server/features/splitline/index.js';
import { stateByAbbr } from '../../../src/server/shared/apportionment/index.js';
import { gridBlocks } from '../../helpers/grid.js';

const all = (n: number) => Int32Array.from({ length: n }, (_, i) => i);
const RI_ZIP = 'data/raw/tl_2020_44_tabblock20.zip';

describe('pooled cut search', () => {
  let pool: ScanPool;
  beforeAll(() => { pool = new ScanPool(4); });
  afterAll(async () => { await pool.close(); });

  // Uneven populations and a ragged outline so many candidates differ and some strand strays.
  const grid = (): Block[] => gridBlocks(23, 17, {
    pop: (x, y) => 1 + ((x * 7 + y * 13) % 11) * ((x + y) % 3),
    skip: (x, y) => (x > 8 && x < 12 && y > 3) || (y === 9 && x > 15),
  });

  it('gives the same cut as one thread on a synthetic grid', () => {
    const blocks = grid();
    const ctx = createContext(blocks, 0.5);
    for (const seats of [2, 3, 5]) {
      const one = findCut(ctx, all(blocks.length), seats);
      const many = findCut(ctx, all(blocks.length), seats, undefined, { pool });
      expect(many).toEqual(one);
    }
  });

  it('gives the same plan as one thread for a whole synthetic state', () => {
    const ctx = createContext(grid(), 0.5);
    expect(splitState(ctx, 7, { pool })).toEqual(splitState(ctx, 7));
  });

  it.skipIf(!existsSync(RI_ZIP))('gives the same Rhode Island plan as one thread', async () => {
    const blocks = await loadStateBlocks(stateByAbbr('RI')!, 'data/raw');
    const ctx = createContext(blocks, 0.5, buildTopology(blocks));
    const one = splitState(ctx, 2);
    const many = splitState(ctx, 2, { pool });
    expect(Array.from(many.assignment)).toEqual(Array.from(one.assignment));
    expect(many.cuts).toEqual(one.cuts);
  }, 120_000);

  it('reuses its workers across cuts and reports their count', () => {
    expect(pool.size).toBe(4);
    const ctx = createContext(gridBlocks(6, 6), 1);
    const a = findCut(ctx, all(36), 2, undefined, { pool });
    const b = findCut(ctx, all(36), 2, undefined, { pool });
    expect(b).toEqual(a);
  });

  it('passes a worker error back to the caller', () => {
    // A piece no worker can evaluate: a negative block count fails when the worker allocates scratch space.
    const empty = { m: -1, total: 0, ids: new Int32Array(0), pops: new Float64Array(0), px: new Float64Array(0), py: new Float64Array(0), lOff: new Int32Array(0), lAdj: new Int32Array(0), lLen: new Float64Array(0) };
    expect(() => pool.scan(empty, { angleCount: 4, seats: 2, orientations: [1] })).toThrow(/length/i);
  });

  it('gives the same result as one thread on a piece that is not connected', () => {
    // {0,1}, {3} and {5,6}: every candidate ends unresolved and the search finds no usable line.
    const ctx = createContext(gridBlocks(7, 1), 1);
    const members = Int32Array.from([0, 1, 3, 5, 6]);
    expect(() => findCut(ctx, members, 2, undefined, { pool })).toThrow(/two connected sides/);
  });
});
