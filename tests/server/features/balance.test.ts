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
});
