import { describe, expect, it } from 'vitest';
import type { Block } from '../../../src/server/entities/census-block/index.js';
import { isConnected } from '../../../src/server/entities/census-block/index.js';
import { compareCandidates, createContext, findCut } from '../../../src/server/features/splitline/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';
import { gridBlocks } from '../../helpers/grid.js';

const all = (n: number) => Int32Array.from({ length: n }, (_, i) => i);
const sorted = (a: Int32Array) => Array.from(a).sort((x, y) => x - y);
/** Replace internal points (degrees) to control which side whole-block assignment puts each block on. */
const withPoints = (blocks: Block[], pts: readonly (readonly [number, number])[]): Block[] =>
  blocks.map((b, i) => ({ ...b, point: pts[i] ?? b.point }));

describe('findCut', () => {
  it('cuts a 4x2 grid with the short north-south line', () => {
    const ctx = createContext(gridBlocks(4, 2));
    const r = findCut(ctx, all(8), 2);
    // The winning range starts at north-south and the line is drawn at its middle.
    expect(r.fromDeg).toBe(0);
    expect(r.angleDeg).toBeCloseTo((r.fromDeg + r.toDeg) / 2, 12);
    expect(r.angleDeg).toBeGreaterThan(r.fromDeg);
    expect(r.angleDeg).toBeLessThan(r.toDeg);
    expect(sorted(r.low)).toEqual([0, 1, 4, 5]);
    expect(r.lengthM).toBeCloseTo(2 * 0.01 * 111_195.08, -1);
    expect(r.skipped).toBe(0);
  });

  it('measures the real block-edge border between the sides', () => {
    const ctx = createContext(gridBlocks(4, 2));
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
    const ctx = createContext(blocks);
    const r = findCut(ctx, all(6), 2);
    const sideOf = (i: number) => (r.low.includes(i) ? 'low' : 'high');
    expect(sideOf(4)).toBe(sideOf(1));
    expect(isConnected(ctx.topo, r.low)).toBe(true);
    expect(isConnected(ctx.topo, r.high)).toBe(true);
    expect(r.fromDeg).toBe(0);
    expect(sorted(r.low)).toEqual([0, 3]);
    expect(r.strayBlocksMoved).toBe(1);
    expect(r.strayPopMoved).toBe(0);
    expect(Math.abs(r.lengthM - 2 * 0.01 * 111_195.08)).toBeLessThan(1);
  });

  it('joins a stray block on the high side to the side around it', () => {
    // Mirror of the case above: W's internal point sits left of the north-south line, so W goes low
    // with the left column while the empty notch block S is assigned high, where only W surrounds it.
    const u = 0.01;
    const P = (x: number, y: number) => [x * u, y * u] as const;
    const sq = (x: number, y: number) => [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]] as const;
    const blk = (i: number, pop: number, point: readonly [number, number], ring: readonly (readonly [number, number])[]): Block => ({
      geoid: '00000' + String(i).padStart(10, '0'), pop, point: P(...point), rings: [ring.map(([x, y]) => P(x, y))],
    });
    const blocks: Block[] = [
      blk(0, 1, [0.5, 0.5], sq(0, 0)),
      blk(1, 2, [1.1, 0.5], [[1, 0], [2, 0], [2, 1], [2, 2], [1.75, 2], [1.75, 1.5], [1.25, 1.5], [1.25, 2], [1, 2], [1, 1], [1, 0]]),
      blk(2, 2, [2.5, 0.5], sq(2, 0)),
      blk(3, 1, [0.5, 1.5], sq(0, 1)),
      blk(4, 0, [1.5, 1.75], [[1.25, 1.5], [1.75, 1.5], [1.75, 2], [1.25, 2], [1.25, 1.5]]),
      blk(5, 2, [2.5, 1.5], sq(2, 1)),
    ];
    const ctx = createContext(blocks);
    const r = findCut(ctx, all(6), 2);
    expect(r.fromDeg).toBe(0);
    expect(sorted(r.low)).toEqual([0, 1, 3, 4]);
    expect(sorted(r.high)).toEqual([2, 5]);
    expect(r.strayBlocksMoved).toBe(1);
    expect(r.strayPopMoved).toBe(0);
  });

  describe('main body of a side', () => {
    // 1xN strip; block A (index 2) holds every person but one and has its internal point placed so
    // both test directions put only A on the low side. The high side is then the blocks left and
    // right of A, and the main body choice decides which group joins A's side and stays there.
    const run = (n: number, pops: readonly number[]) => {
      const base = gridBlocks(n, 1, { pop: (x) => pops[x] ?? 0 });
      const blocks = withPoints(base, base.map((_, i) => (i === 2 ? ([-0.05, 0.1] as const) : ([0.01 * i + 0.1, -0.1] as const))));
      return findCut(createContext(blocks), all(n), 2);
    };

    it('is the group with the most people', () => {
      const r = run(6, [1, 0, 100]);
      expect(sorted(r.high)).toEqual([0, 1]);
      expect(sorted(r.low)).toEqual([2, 3, 4, 5]);
    });

    // With A holding every person, the re-count's closest split of the free blocks is a tie between
    // 0 and 100 people on the low side, and a tie stops before A: A joins the main group on the high
    // side, and the stray group, fixed on the low side, is the whole low side.
    it('on equal people, is the group with more blocks', () => {
      const r = run(6, [0, 0, 100]);
      expect(sorted(r.low)).toEqual([0, 1]);
      expect(sorted(r.high)).toEqual([2, 3, 4, 5]);
      expect(r.strayBlocksMoved).toBe(2);
    });

    it('on equal people and blocks, is the group holding the lowest block index', () => {
      const r = run(5, [0, 0, 100]);
      expect(sorted(r.low)).toEqual([3, 4]);
      expect(sorted(r.high)).toEqual([0, 1, 2]);
      expect(r.strayBlocksMoved).toBe(2);
    });
  });

  it('ends the strays passes on a piece that is not connected, then finds no usable line', () => {
    // A real piece is always connected (through bridges if needed). Strip of 7 with blocks 2 and 4
    // left out: {0,1}, {3} and {5,6}. The lone block 3 touches nothing, so it is a stray on whichever
    // side it lands; it moves once and is fixed, so every candidate ends, unresolved.
    const ctx = createContext(gridBlocks(7, 1));
    const run = () => findCut(ctx, Int32Array.from([0, 1, 3, 5, 6]), 2);
    expect(run).toThrow(DataError);
    expect(run).toThrow(/two connected sides/);
  });

  it('accepts a guide line that crosses the piece twice', () => {
    // A U lying on its side: a 2x3 base on the west, arms one block high running east along the
    // bottom and top rows. The top arm's two east blocks (12, 13) hold half the people and the bottom
    // arm's two east blocks (4, 5) are empty. The north-south line cuts both arms; the empty bottom
    // tip joins the side around it (0 people), so the re-count has nothing to give back and the line's
    // one-edge border wins.
    const pop = (x: number, y: number) => (x >= 4 ? (y === 2 ? 5 : 0) : 1);
    const blocks = gridBlocks(6, 3, { skip: (x, y) => x >= 2 && y === 1, pop });
    const ctx = createContext(blocks);
    const r = findCut(ctx, all(blocks.length), 2);
    expect(r.fromDeg).toBe(0);
    expect(sorted(r.high)).toEqual([12, 13]);
    expect(r.spans).toHaveLength(2);
    expect(r.strayBlocksMoved).toBe(2);
    expect(r.strayPopMoved).toBe(0);
    expect(Math.abs(r.lengthM - 0.01 * 111_195.08)).toBeLessThan(1);
  });

  it('breaks a length tie toward north-south', () => {
    // Centered on the equator, the east-west border runs along it and is exactly as long as the north-south one.
    // North of the equator the east-west border would be a hair shorter and win outright.
    const ctx = createContext(gridBlocks(2, 2, { origin: [0, -0.01] }));
    const r = findCut(ctx, all(4), 2);
    expect(r.fromDeg).toBe(0);
    expect(sorted(r.low)).toEqual([0, 2]);
  });

  it('splits population, not block count', () => {
    // 4x1 strip; the first block holds half the people.
    const ctx = createContext(gridBlocks(4, 1, { pop: (x) => (x === 0 ? 3 : 1) }));
    const r = findCut(ctx, all(4), 2);
    expect(sorted(r.low)).toEqual([0]);
  });

  it('gives an odd seat count the floor/ceil ratio', () => {
    const ctx = createContext(gridBlocks(3, 1));
    const r = findCut(ctx, all(3), 3);
    expect([r.lowSeats, r.highSeats].sort()).toEqual([1, 2]);
    expect(r.low.length).toBe(r.lowSeats);
  });

  it('skips the shortest range when its sides fail validation and takes the next', () => {
    const ctx = createContext(gridBlocks(4, 2));
    let calls = 0;
    const r = findCut(ctx, all(8), 2, () => ++calls > 1);
    expect(r.skipped).toBe(1);
    const [first, second] = r.candidates;
    expect(first!.fromDeg).toBe(0);
    expect([r.fromDeg, r.toDeg, r.lowSeats]).toEqual([second!.fromDeg, second!.toDeg, second!.lowSeats]);
    expect(r.lengthM).toBeGreaterThanOrEqual(first!.lengthM);
  });

  it('reports the candidate ranges in the generator order, the winner first', () => {
    const ctx = createContext(gridBlocks(6, 5, { pop: (x, y) => 1 + ((x * 7 + y * 3) % 5) }));
    const r = findCut(ctx, all(30), 3);
    expect(r.candidates.length).toBeGreaterThan(1);
    expect(r.candidateRanges).toBeGreaterThanOrEqual(r.candidates.length);
    expect([r.fromDeg, r.toDeg, r.lowSeats, r.lengthM]).toEqual([r.candidates[0]!.fromDeg, r.candidates[0]!.toDeg, r.candidates[0]!.lowSeats, r.candidates[0]!.lengthM]);
    for (let i = 1; i < r.candidates.length; i++) expect(compareCandidates(r.candidates[i - 1]!, r.candidates[i]!)).toBeLessThanOrEqual(0);
    for (const c of r.candidates) {
      expect(c.fromDeg).toBeLessThan(c.toDeg);
      expect(c.nearestNorthSouthDeg === c.fromDeg || c.nearestNorthSouthDeg === c.toDeg || c.toDeg === 180).toBe(true);
    }
  });

  it('draws the guide line at the middle of the winning range', () => {
    const r = findCut(createContext(gridBlocks(5, 4, { pop: (x, y) => 1 + ((x * 3 + y * 5) % 4) })), all(20), 2);
    expect(r.angleDeg).toBeCloseTo((r.fromDeg + r.toDeg) / 2, 12);
    expect(r.fromDeg).toBeLessThan(r.toDeg);
    expect(r.fromDeg).toBeGreaterThanOrEqual(0);
    expect(r.toDeg).toBeLessThanOrEqual(180);
  });

  it('is deterministic', () => {
    const blocks = gridBlocks(6, 5, { pop: (x, y) => 1 + ((x * 7 + y * 3) % 5) });
    const a = findCut(createContext(blocks), all(30), 3);
    const b = findCut(createContext(blocks), all(30), 3);
    expect(sorted(a.low)).toEqual(sorted(b.low));
    expect(a.angleDeg).toBe(b.angleDeg);
    expect(a.lengthM).toBe(b.lengthM);
  });
});
