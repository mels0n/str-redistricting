import { describe, expect, it } from 'vitest';
import { isConnected } from '../../../src/server/entities/census-block/index.js';
import { createContext, splitState } from '../../../src/server/features/splitline/index.js';
import { gridBlocks } from '../../helpers/grid.js';

const districtPops = (assignment: Int32Array, pops: number[], seats: number) => {
  const out = new Array<number>(seats).fill(0);
  assignment.forEach((d, i) => { out[d]! += pops[i]!; });
  return out;
};

describe('splitState', () => {
  it('draws 4 equal, connected districts on a uniform 4x4 grid in 3 cuts', () => {
    const blocks = gridBlocks(4, 4);
    const ctx = createContext(blocks, 1);
    const r = splitState(ctx, 4);
    expect(r.cuts).toHaveLength(3);
    expect(districtPops(r.assignment, blocks.map((b) => b.pop), 4)).toEqual([4, 4, 4, 4]);
    for (let d = 0; d < 4; d++) {
      const members = Int32Array.from([...r.assignment.keys()].filter((i) => r.assignment[i] === d));
      expect(isConnected(ctx.topo, members)).toBe(true);
    }
  });
  it('handles an odd seat count', () => {
    const blocks = gridBlocks(3, 1);
    const r = splitState(createContext(blocks, 1), 3);
    expect(districtPops(r.assignment, [1, 1, 1], 3)).toEqual([1, 1, 1]);
  });
  it('returns one district without cutting when seats = 1', () => {
    const r = splitState(createContext(gridBlocks(2, 2), 1), 1);
    expect(Array.from(r.assignment)).toEqual([0, 0, 0, 0]);
    expect(r.cuts).toHaveLength(0);
  });
});
