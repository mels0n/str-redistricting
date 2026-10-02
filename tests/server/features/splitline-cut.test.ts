import { describe, expect, it } from 'vitest';
import type { Block } from '../../../src/server/entities/census-block/index.js';
import { isConnected } from '../../../src/server/entities/census-block/index.js';
import { createContext, findCut } from '../../../src/server/features/splitline/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';
import { gridBlocks } from '../../helpers/grid.js';

const all = (n: number) => Int32Array.from({ length: n }, (_, i) => i);
const sorted = (a: Int32Array) => Array.from(a).sort((x, y) => x - y);
/** Replace internal points (degrees) to control which side whole-block assignment puts each block on. */
const withPoints = (blocks: Block[], pts: readonly (readonly [number, number])[]): Block[] =>
  blocks.map((b, i) => ({ ...b, point: pts[i] ?? b.point }));
/** 1x4 strip with the given populations; the north-south line puts 0, 1, 3 low, the east-west line 0, 1. */
const strip = (pops: readonly number[], p3: readonly [number, number] = [0.002, -0.02]) =>
  withPoints(gridBlocks(4, 1, { pop: (x) => pops[x]! }), [[0, 0.03], [0.001, 0.02], [0.03, 0], p3]);

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
    const ctx = createContext(blocks, 1);
    const r = findCut(ctx, all(6), 2);
    expect(r.angleDeg).toBe(0);
    expect(sorted(r.low)).toEqual([0, 1, 3, 4]);
    expect(sorted(r.high)).toEqual([2, 5]);
    expect(r.strayBlocksMoved).toBe(1);
    expect(r.strayPopMoved).toBe(0);
  });

  it('moves a stray again when the side it joined strands it too', () => {
    // 7x5 grid. The 5x5 square on the left is three nested parts: the centre block C, the ring R1
    // around it, and the outer ring R2. The 2x5 strip on the right is H. Whole-block assignment puts
    // C and R2 low, R1 and H high (internal points placed to force it). On the low side C is a stray
    // and joins the high side, where it merges with R1; on the high side R1 + C is not the main body
    // (H holds the people), so it joins the low side. C ends where it began: it moved twice.
    const w = 7, h = 5;
    const inSquare = (x: number) => x < 5;
    const ring = (x: number, y: number) => Math.max(Math.abs(x - 2), Math.abs(y - 2));
    const isLow = (x: number, y: number) => inSquare(x) && ring(x, y) !== 1;
    const hPops = [2, 2, 2, 2, 2, 2, 1, 1, 1, 1];
    let hIdx = 0;
    const base = gridBlocks(w, h, { pop: (x, y) => (!inSquare(x) ? hPops[hIdx++]! : ring(x, y) === 2 ? 1 : 0) });
    const pts = base.map((_, i) => {
      const x = i % w, y = Math.floor(i / w);
      return isLow(x, y) ? ([-0.05, 0.1] as const) : ([0.2, -0.1] as const);
    });
    const blocks = withPoints(base, pts);
    const ctx = createContext(blocks, 90);
    const r = findCut(ctx, all(blocks.length), 2);
    const square = base.flatMap((_, i) => (inSquare(i % w) ? [i] : []));
    const centre = 2 * w + 2;
    expect(sorted(r.low)).toEqual(square);
    expect(r.low.includes(centre)).toBe(true);
    expect(r.strayBlocksMoved).toBe(8);
    expect(r.strayPopMoved).toBe(0);
    expect(isConnected(ctx.topo, r.low)).toBe(true);
    expect(isConnected(ctx.topo, r.high)).toBe(true);
  });

  describe('main body of a side', () => {
    // 1xN strip; block A (index 2) holds every person but one and has its internal point placed so
    // both test directions put only A on the low side. The high side is then the blocks left and
    // right of A, and the main body choice decides which group joins A.
    const run = (n: number, pops: readonly number[]) => {
      const base = gridBlocks(n, 1, { pop: (x) => pops[x] ?? 0 });
      const blocks = withPoints(base, base.map((_, i) => (i === 2 ? ([-0.05, 0.1] as const) : ([0.01 * i + 0.1, -0.1] as const))));
      return findCut(createContext(blocks, 90), all(n), 2);
    };

    it('is the group with the most people', () => {
      const r = run(6, [1, 0, 100]);
      expect(sorted(r.high)).toEqual([0, 1]);
      expect(sorted(r.low)).toEqual([2, 3, 4, 5]);
    });

    it('on equal people, is the group with more blocks', () => {
      const r = run(6, [0, 0, 100]);
      expect(sorted(r.high)).toEqual([3, 4, 5]);
      expect(sorted(r.low)).toEqual([0, 1, 2]);
    });

    it('on equal people and blocks, is the group holding the lowest block index', () => {
      const r = run(5, [0, 0, 100]);
      expect(sorted(r.high)).toEqual([0, 1]);
      expect(sorted(r.low)).toEqual([2, 3, 4]);
    });
  });

  it('fails with a DataError when stray pieces keep moving for 10 passes', () => {
    // Only reachable on a piece that is not connected (a real piece is always connected, through
    // bridges if needed). Strip of 7 with blocks 2 and 4 left out: {0,1}, {3} and {5,6}. The lone
    // block 3 touches nothing, so it is a stray on whichever side it lands and flips every pass.
    const ctx = createContext(gridBlocks(7, 1), 1);
    expect(() => findCut(ctx, Int32Array.from([0, 1, 3, 5, 6]), 2)).toThrow(/10 passes/);
  });

  it('rejects lines whose strays exceed the cap and takes an eligible one', () => {
    // U shape: two full base rows, arms one block wide, one person per block (14 people, 2 seats,
    // cap = 1% of 7 = 0.07 people). A line across both arms strands part of an arm (at least one
    // person) and is rejected; the shortest line that strands nobody is north-south with a
    // three-edge border.
    const blocks = gridBlocks(3, 6, { skip: (x, y) => x === 1 && y >= 2 });
    const ctx = createContext(blocks, 1);
    const r = findCut(ctx, all(blocks.length), 2);
    expect(r.strayCapRejected).toBeGreaterThan(0);
    expect(r.skipped).toBeGreaterThanOrEqual(r.strayCapRejected);
    expect(r.strayPopMoved).toBe(0);
    expect(r.spans).toHaveLength(1);
    expect(r.angleDeg).toBe(0);
    expect(Math.abs(r.lengthM - 3 * 0.01 * 111_195.08)).toBeLessThan(1);
    expect(isConnected(ctx.topo, r.low)).toBe(true);
    expect(isConnected(ctx.topo, r.high)).toBe(true);
  });

  it('accepts a guide line that crosses the piece twice when its strays fit under the cap', () => {
    // A U lying on its side: a 2x3 base on the west, arms one block high running east along the
    // bottom and top rows. The top arm's two east blocks (12, 13) hold half the people and the bottom
    // arm's two east blocks (4, 5) are empty. The north-south line cuts both arms; the empty bottom
    // tip joins the side around it (0 people), so the line is eligible and its one-edge border wins.
    const pop = (x: number, y: number) => (x >= 4 ? (y === 2 ? 5 : 0) : 1);
    const blocks = gridBlocks(6, 3, { skip: (x, y) => x >= 2 && y === 1, pop });
    const ctx = createContext(blocks, 1);
    const r = findCut(ctx, all(blocks.length), 2);
    expect(r.angleDeg).toBe(0);
    expect(sorted(r.high)).toEqual([12, 13]);
    expect(r.spans).toHaveLength(2);
    expect(r.strayBlocksMoved).toBe(2);
    expect(r.strayPopMoved).toBe(0);
    expect(Math.abs(r.lengthM - 0.01 * 111_195.08)).toBeLessThan(1);
  });

  it('allows strays exactly at the cap and rejects one person over', () => {
    // 2,000 people, 2 seats: cap = 1% of 1,000 = 10 people. The north-south line strands block 3,
    // which joins the high side; the east-west line strands nobody. Both end with the same sides,
    // so north-south wins the tie when it is eligible.
    const at = strip([495, 495, 1000, 10]);
    const rAt = findCut(createContext(at, 90), all(4), 2);
    expect(rAt.angleDeg).toBe(0);
    expect(rAt.strayPopMoved).toBe(10);
    expect(rAt.strayCapRejected).toBe(0);
    expect(sorted(rAt.low)).toEqual([0, 1]);

    const over = strip([494, 495, 1000, 11]);
    const rOver = findCut(createContext(over, 90), all(4), 2);
    expect(rOver.angleDeg).toBe(90);
    expect(rOver.strayPopMoved).toBe(0);
    expect(rOver.strayCapRejected).toBe(1);
    expect(rOver.skipped).toBe(1);
    expect(sorted(rOver.low)).toEqual([0, 1]);
  });

  it('fails with a DataError when no line meets the stray cap', () => {
    // As above, 11 people over a cap of 10, but block 3 is placed so the east-west line strands it too.
    const blocks = strip([494, 495, 1000, 11], [0.002, 0.025]);
    const run = () => findCut(createContext(blocks, 90), all(4), 2);
    expect(run).toThrow(DataError);
    expect(run).toThrow(/stray cap/);
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
