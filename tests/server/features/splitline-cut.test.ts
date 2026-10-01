import { describe, expect, it } from 'vitest';
import { createContext, findCut } from '../../../src/server/features/splitline/index.js';
import { gridBlocks } from '../../helpers/grid.js';

const all = (n: number) => Int32Array.from({ length: n }, (_, i) => i);
const sorted = (a: Int32Array) => Array.from(a).sort((x, y) => x - y);

describe('findCut', () => {
  it('cuts a 4x2 grid with the short north-south line', () => {
    const ctx = createContext(gridBlocks(4, 2), 1);
    const r = findCut(ctx, all(8), 2);
    expect(r.angleDeg).toBe(0);
    expect(sorted(r.low)).toEqual([0, 1, 4, 5]);
    expect(r.lengthM).toBeCloseTo(2 * 0.01 * 111_195.08, -1);
    expect(r.skipped).toBe(0);
  });

  it('breaks a length tie toward north-south', () => {
    const ctx = createContext(gridBlocks(2, 2), 1);
    const r = findCut(ctx, all(4), 2);
    expect(r.angleDeg).toBe(0);
    expect(sorted(r.low)).toEqual([0, 2]);
  });

  it('splits population, not block count', () => {
    // 4x1 strip; the first block holds half the people.
    const ctx = createContext(gridBlocks(4, 1, { pop: (x) => (x === 0 ? 3 : 1) }), 1);
    const r = findCut(ctx, all(4), 2);
    expect(sorted(r.low)).toEqual([0]);
  });

  it('gives an odd seat count the floor/ceil ratio', () => {
    const ctx = createContext(gridBlocks(3, 1), 1);
    const r = findCut(ctx, all(3), 3);
    expect([r.lowSeats, r.highSeats].sort()).toEqual([1, 2]);
    expect(r.low.length).toBe(r.lowSeats);
  });

  it('skips the shortest line when its sides fail validation and takes the next', () => {
    const ctx = createContext(gridBlocks(4, 2), 1);
    let calls = 0;
    const r = findCut(ctx, all(8), 2, () => ++calls > 1);
    expect(r.skipped).toBe(1);
    expect(r.angleDeg).not.toBe(0);
  });

  it('is deterministic', () => {
    const blocks = gridBlocks(6, 5, { pop: (x, y) => 1 + ((x * 7 + y * 3) % 5) });
    const a = findCut(createContext(blocks, 0.5), all(30), 3);
    const b = findCut(createContext(blocks, 0.5), all(30), 3);
    expect(sorted(a.low)).toEqual(sorted(b.low));
    expect(a.angleDeg).toBe(b.angleDeg);
  });
});
