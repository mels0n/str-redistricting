import { describe, expect, it } from 'vitest';
import { buildTopology, isConnected } from '../../../src/server/entities/census-block/index.js';
import { balance } from '../../../src/server/features/balance/index.js';
import { gridBlocks } from '../../helpers/grid.js';

describe('balance', () => {
  it('moves a border block from the larger to the smaller district', () => {
    const blocks = gridBlocks(4, 1);
    const r = balance(blocks, buildTopology(blocks), Int32Array.from([0, 0, 0, 1]), 2);
    expect(Array.from(r.assignment)).toEqual([0, 0, 1, 1]);
    expect(r.moves).toBe(1);
  });
  it('reduces imbalance and keeps every district connected', () => {
    const blocks = gridBlocks(5, 4, { pop: (x, y) => 1 + ((x * 3 + y * 5) % 4) });
    const topo = buildTopology(blocks);
    const start = Int32Array.from(blocks.map((_, i) => (i % 5 < 3 ? 0 : 1)));
    const spread = (a: Int32Array) => {
      const p = [0, 0];
      a.forEach((d, i) => { p[d]! += blocks[i]!.pop; });
      return Math.abs(p[0]! - p[1]!);
    };
    const r = balance(blocks, topo, start, 2);
    expect(spread(r.assignment)).toBeLessThan(spread(start));
    for (const d of [0, 1]) {
      const members = Int32Array.from([...r.assignment.keys()].filter((i) => r.assignment[i] === d));
      expect(isConnected(topo, members)).toBe(true);
    }
  });
  it('leaves an already balanced plan alone', () => {
    const blocks = gridBlocks(2, 1);
    const r = balance(blocks, buildTopology(blocks), Int32Array.from([0, 1]), 2);
    expect(r.moves).toBe(0);
  });
  it('makes no move whose exact gain is zero at large populations', () => {
    const pops = [700001, 300, 700001];
    const blocks = gridBlocks(3, 1, { pop: (x) => pops[x]! });
    const r = balance(blocks, buildTopology(blocks), Int32Array.from([0, 0, 1]), 2);
    expect(r.moves).toBe(0);
    expect(Array.from(r.assignment)).toEqual([0, 0, 1]);
  });
  it('rejects a cut-vertex move and takes the best legal one', () => {
    const pops = [1, 3, 1, 0, 0, 0];
    const blocks = gridBlocks(3, 2, { pop: (x, y) => pops[y * 3 + x]! });
    const topo = buildTopology(blocks);
    const r = balance(blocks, topo, Int32Array.from([0, 0, 0, 1, 1, 1]), 2);
    expect(r.assignment[1]).toBe(0);
    expect(Array.from(r.assignment)).toEqual([1, 0, 1, 1, 1, 1]);
    expect(r.moves).toBe(2);
    for (const d of [0, 1]) {
      const members = Int32Array.from([...r.assignment.keys()].filter((i) => r.assignment[i] === d));
      expect(isConnected(topo, members)).toBe(true);
    }
  });
  it('is deterministic and leaves its input untouched', () => {
    const blocks = gridBlocks(5, 4, { pop: (x, y) => 1 + ((x * 3 + y * 5) % 4) });
    const topo = buildTopology(blocks);
    const start = Int32Array.from(blocks.map((_, i) => (i % 5 < 3 ? 0 : 1)));
    const copy = Int32Array.from(start);
    const a = balance(blocks, topo, start, 2);
    const b = balance(blocks, topo, start, 2);
    expect(Array.from(a.assignment)).toEqual(Array.from(b.assignment));
    expect(a.moves).toBe(b.moves);
    expect(Array.from(start)).toEqual(Array.from(copy));
  });
});
