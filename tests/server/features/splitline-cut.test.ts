import { describe, expect, it } from 'vitest';
import type { Block } from '../../../src/server/entities/census-block/index.js';
import { isConnected } from '../../../src/server/entities/census-block/index.js';
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

  it('measures the real block-edge border between the sides', () => {
    const ctx = createContext(gridBlocks(4, 2), 1);
    const r = findCut(ctx, all(8), 2);
    expect(Math.abs(r.lengthM - 2 * 0.01 * 111_195.08)).toBeLessThan(1);
    expect(r.strayBlocksMoved).toBe(0);
    expect(r.strayPopMoved).toBe(0);
  });

  it('joins a stray block stranded by a straddling block to the side around it', () => {
    // Units of 0.01 degree. Columns 0 and 2 are plain squares; the middle column is one big block W
    // with a notch on its top edge holding a small empty block S. W's internal point sits right of
    // the north-south guide line, S's on it, so S is assigned left while only W surrounds it.
    const u = 0.01;
    const P = (x: number, y: number) => [x * u, y * u] as const;
    const blk = (i: number, pop: number, point: readonly [number, number], ring: (readonly [number, number])[]): Block => ({
      geoid: '00000' + String(i).padStart(10, '0'), pop, point: P(...point), rings: [ring.map(([x, y]) => P(x, y))],
    });
    const sq = (x: number, y: number) => [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]] as const;
    const blocks: Block[] = [
      blk(0, 1, [0.5, 0.5], [...sq(0, 0)]),
      blk(1, 2, [1.9, 0.5], [[1, 0], [2, 0], [2, 1], [2, 2], [1.75, 2], [1.75, 1.5], [1.25, 1.5], [1.25, 2], [1, 2], [1, 1], [1, 0]]),
      blk(2, 1, [2.5, 0.5], [...sq(2, 0)]),
      blk(3, 1, [0.5, 1.5], [...sq(0, 1)]),
      blk(4, 0, [1.5, 1.75], [[1.25, 1.5], [1.75, 1.5], [1.75, 2], [1.25, 2], [1.25, 1.5]]),
      blk(5, 1, [2.5, 1.5], [...sq(2, 1)]),
    ];
    const ctx = createContext(blocks, 1);
    const r = findCut(ctx, all(6), 2);
    const sideOf = (i: number) => (r.low.includes(i) ? 'low' : 'high');
    expect(sideOf(4)).toBe(sideOf(1));
    expect(isConnected(ctx.topo, r.low)).toBe(true);
    expect(isConnected(ctx.topo, r.high)).toBe(true);
    expect(r.angleDeg).toBe(0);
    expect(sorted(r.low)).toEqual([0, 3]);
    expect(r.strayBlocksMoved).toBe(1);
    expect(r.strayPopMoved).toBe(0);
    expect(Math.abs(r.lengthM - 2 * 0.01 * 111_195.08)).toBeLessThan(1);
  });

  it('skips guide lines that cross the piece more than once', () => {
    // U shape: two full base rows, arms one block wide. A tilted line across both arms (15 degrees)
    // would leave a two-edge border after strays, but it crosses the outline twice and is not
    // eligible; the best single-crossing line is north-south with a three-edge border.
    const blocks = gridBlocks(3, 6, { skip: (x, y) => x === 1 && y >= 2 });
    const ctx = createContext(blocks, 1);
    const r = findCut(ctx, all(blocks.length), 2);
    expect(r.crossingRejected).toBeGreaterThan(0);
    expect(r.skipped).toBeGreaterThanOrEqual(r.crossingRejected);
    expect(r.spans).toHaveLength(1);
    expect(r.angleDeg).toBe(0);
    expect(Math.abs(r.lengthM - 3 * 0.01 * 111_195.08)).toBeLessThan(1);
    expect(isConnected(ctx.topo, r.low)).toBe(true);
    expect(isConnected(ctx.topo, r.high)).toBe(true);
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
    expect(a.lengthM).toBe(b.lengthM);
  });
});
