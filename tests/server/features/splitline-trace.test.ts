import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Block } from '../../../src/server/entities/census-block/index.js';
import { createContext, findCut, ScanPool, type CutResult } from '../../../src/server/features/splitline/index.js';
import { gridBlocks } from '../../helpers/grid.js';
import { containsNorthSouth } from '../../helpers/ranges.js';

const u = 0.01;
const all = (n: number) => Int32Array.from({ length: n }, (_, i) => i);
const sorted = (a: Int32Array) => Array.from(a).sort((x, y) => x - y);
/** Grid of unit squares; internal points nudged east by 0.05 per row so west-to-east order is fixed. */
const nudged = (w: number, h: number, pop: (x: number, y: number) => number, skip: (x: number, y: number) => boolean) => {
  const blocks: Block[] = [];
  for (const b of gridBlocks(w, h, { pop, skip })) {
    const i = Number(b.geoid.slice(5));
    const x = i % w, y = Math.floor(i / w);
    blocks.push({ ...b, point: [(x + 0.5 + 0.05 * y) * u, (y + 0.5) * u] });
  }
  return blocks;
};
// The U shape from the re-count tests: the north-south line (0 degrees) strands an arm and re-counts once.
const uShape = () => nudged(4, 5, (x, y) => (x === 1 && y === 1 ? 3 : 1), (x, y) => x >= 2 && y >= 1 && y <= 3);
// A U that cannot resolve: the north-south line stops unresolved.
const stuckU = () => nudged(4, 5, () => 1, (x, y) => x >= 2 && y >= 1 && y <= 3);
// An uneven seat count on a skewed grid gives two orientations and many ranges of directions.
const field = () => gridBlocks(7, 6, { pop: (x, y) => 1 + ((x * 3 + y * 5) % 7) });
// Two separate stray arms on the east side: the east-west line (90 degrees) needs three strays passes.
const twoArms = () => nudged(4, 7, (x, y) => (x === 1 && (y === 1 || y === 4) ? 3 : 1), (x, y) => x >= 2 && ((y >= 1 && y <= 2) || (y >= 4 && y <= 5)));
// A uniform square centered on the equator: the east-west border runs along the equator, so it is exactly as long as
// the north-south one and the GEOID tie rule decides. (North of the equator the east-west border would be a hair shorter.)
const square = () => gridBlocks(4, 4, { origin: [0, -0.02] });
// A range of directions narrower than this cannot be told from its neighbours by a direction given in degrees: the
// lines of a grid are parallel to within rounding, so the recorded line at the middle of such a range is not the
// range's own.
const NARROW_DEG = 1e-6;
const wide = (r: CutResult) => r.candidates.filter((c) => c.toDeg - c.fromDeg > NARROW_DEG);
/** One trace request per candidate range wide enough to name, at the middle of its directions. */
const every = (r: CutResult) => wide(r).map((c) => ({ angleDeg: (c.fromDeg + c.toDeg) / 2, lowSeats: c.lowSeats, reversed: c.reversed }));
const sameResult = (a: CutResult, b: CutResult) => {
  expect(sorted(a.low)).toEqual(sorted(b.low));
  expect(sorted(a.high)).toEqual(sorted(b.high));
  expect(a.angleDeg).toBe(b.angleDeg);
  expect(a.lengthM).toBe(b.lengthM);
  expect(a.candidates).toEqual(b.candidates);
};

describe('candidate trace', () => {
  it('trace leaves the result unchanged', () => {
    for (const [blocks, seats] of [[uShape(), 2], [stuckU(), 2], [field(), 3], [twoArms(), 2], [square(), 2]] as const) {
      const ctx = createContext(blocks);
      const plain = findCut(ctx, all(blocks.length), seats);
      const traced = findCut(ctx, all(blocks.length), seats, undefined, { trace: every(plain) });
      sameResult(traced, plain);
      expect(plain.traces).toEqual([]);
      expect(traced.traces.length).toBe(wide(plain).length);
    }
  });

  it('the parity fixtures include a cut with three strays passes and an exact border-length tie', () => {
    const arms = twoArms();
    const armsCtx = createContext(arms);
    const armsPlain = findCut(armsCtx, all(arms.length), 2);
    const armsTraced = findCut(armsCtx, all(arms.length), 2, undefined, { trace: [...every(armsPlain), { angleDeg: 90, lowSeats: 1 }] });
    // At least one traced line settles strays three times.
    expect(Math.max(...armsTraced.traces.map((t) => t.passes.length))).toBeGreaterThanOrEqual(3);

    const sq = square();
    const sqCtx = createContext(sq);
    const sqPlain = findCut(sqCtx, all(sq.length), 2);
    const [p, q] = sqPlain.candidates;
    // Different ranges of directions, exactly the same length, different sides: GEOID decides (east-west here).
    expect(p!.fromDeg).not.toBe(q!.fromDeg);
    expect(p!.lengthM).toBe(q!.lengthM);
    expect(sqPlain.tiedCuts).toBe(2);
    expect(containsNorthSouth(sqPlain)).toBe(false);
  });

  it('trace of the winning candidate matches the result', () => {
    for (const [blocks, seats] of [[uShape(), 2], [stuckU(), 2], [field(), 3]] as const) {
      const ctx = createContext(blocks);
      const r = findCut(ctx, all(blocks.length), seats);
      const [t] = findCut(ctx, all(blocks.length), seats, undefined, { trace: [{ angleDeg: r.angleDeg, lowSeats: r.lowSeats }] }).traces;
      expect(t!.lowSeats).toBe(r.lowSeats);
      expect(t!.angleDeg).toBe(r.angleDeg);
      expect(sorted(t!.low)).toEqual(sorted(r.low));
      expect(sorted(t!.high)).toEqual(sorted(r.high));
      expect(t!.lengthM).toBe(r.lengthM);
      // The same line, up to the rounding of the angle.
      const ends = (spans: CutResult['spans']) => spans.flatMap((sp) => sp.flatMap((pt) => Array.from(pt)));
      expect(ends(t!.passes.at(-1)!.spans)).toHaveLength(ends(r.spans).length);
      ends(t!.passes.at(-1)!.spans).forEach((v, i) => expect(v).toBeCloseTo(ends(r.spans)[i]!, 12));
      expect(t!.passes.length).toBe(r.iterations);
    }
  });

  it('trace passes end when nothing moves', () => {
    for (const [blocks, seats] of [[uShape(), 2], [stuckU(), 2], [field(), 3]] as const) {
      const ctx = createContext(blocks);
      const plain = findCut(ctx, all(blocks.length), seats);
      const { traces } = findCut(ctx, all(blocks.length), seats, undefined, { trace: every(plain) });
      traces.forEach((t, i) => {
        const c = wide(plain)[i]!;
        const last = t.passes.at(-1)!;
        expect(last.moved.length === 0 || t.unresolved).toBe(true);
        // Candidates are resolved ranges, and the trace reaches the range's length from the middle of its directions.
        expect(t.unresolved).toBe(false);
        expect(t.lengthM).toBe(c.lengthM);
        expect(t.lowSeats).toBe(c.lowSeats);
        expect(t.order.length).toBe(blocks.length);
        expect(sorted(t.order)).toEqual(Array.from(all(blocks.length)));
        expect(t.low.length + t.high.length).toBe(blocks.length);
        const total = blocks.reduce((p, b) => p + b.pop, 0);
        expect(t.share).toBe((total * t.lowSeats) / seats);
        expect(t.passes[0]!.target).toBe(t.share);
        expect(t.passes[0]!.fixedLow.length + t.passes[0]!.fixedHigh.length).toBe(0);
      });
    }
  });

  it('records each pass of a re-count', () => {
    const blocks = uShape();
    const ctx = createContext(blocks);
    const [t] = findCut(ctx, all(blocks.length), 2, undefined, { trace: [{ angleDeg: 0, lowSeats: 1 }] }).traces;
    expect(t!.passes.length).toBe(2);
    const p1 = t!.passes[0]!, p2 = t!.passes[1]!;
    // Pass 1: whole blocks put 9 people low, and the bottom arm (2 blocks) moves to the low side.
    expect(p1.walkLow.length).toBeGreaterThan(0);
    expect(p1.moved.length).toBe(2);
    expect(p1.spans.length).toBeGreaterThan(0);
    // Pass 2: the arm is held on the low side, so the walk's target drops by its 2 people.
    expect(sorted(p2.fixedLow)).toEqual(sorted(p1.moved));
    expect(p2.fixedHigh.length).toBe(0);
    expect(p2.target).toBe(t!.share - 2);
    expect(p2.moved.length).toBe(0);
    for (const b of p2.fixedLow) expect(t!.low.includes(b)).toBe(true);
  });

  it('records the groups each side splits into and which one is the main body', () => {
    const blocks = uShape();
    const ctx = createContext(blocks);
    const [t] = findCut(ctx, all(blocks.length), 2, undefined, { trace: [{ angleDeg: 0, lowSeats: 1 }] }).traces;
    const p1 = t!.passes[0]!, p2 = t!.passes[1]!;
    // Pass 1: only the second side is in two groups, its main body and the cut-off arm.
    expect(p1.sweeps.length).toBe(1);
    const sw = p1.sweeps[0]!;
    expect(sw.side).toBe(1);
    expect(sw.groups.length).toBe(2);
    expect(sw.groups.filter((g) => g.main).length).toBe(1);
    const main = sw.groups.find((g) => g.main)!, arm = sw.groups.find((g) => !g.main)!;
    expect(sorted(arm.blocks)).toEqual(sorted(p1.moved));
    expect(main.pop).toBeGreaterThan(arm.pop);
    for (const g of sw.groups) {
      expect(g.pop).toBe(Array.from(g.blocks).reduce((s, b) => s + blocks[b]!.pop, 0));
      expect(g.fixed.length).toBe(0);
    }
    // Pass 2: both sides are whole, so nothing is recorded.
    expect(p2.sweeps).toEqual([]);
  });

  it('records a cut-off group whose fixed blocks cannot move', () => {
    const blocks = stuckU();
    const ctx = createContext(blocks);
    const [t] = findCut(ctx, all(blocks.length), 2, undefined, { trace: [{ angleDeg: 0, lowSeats: 1 }] }).traces;
    expect(t!.unresolved).toBe(true);
    const last = t!.passes.at(-1)!;
    const stuck = last.sweeps.flatMap((s) => s.groups).filter((g) => !g.main && g.fixed.length > 0);
    expect(stuck.length).toBeGreaterThan(0);
    for (const g of stuck) for (const b of g.fixed) expect(last.moved.includes(b)).toBe(false);
  });

  it('walk order follows the direction with the block-id tie-break', () => {
    // k = 0 orders west to east.
    const row = gridBlocks(4, 1);
    const [w] = findCut(createContext(row), Int32Array.from([2, 0, 3, 1]), 2, undefined, { trace: [{ angleDeg: 0, lowSeats: 1 }] }).traces;
    expect(Array.from(w!.order)).toEqual([0, 1, 2, 3]);
    // Blocks 1 and 2 share an internal point, so their keys tie and the lower block index walks first.
    const tied = gridBlocks(4, 1).map((b, i) => (i === 2 ? { ...b, point: row[1]!.point } : b));
    const [t] = findCut(createContext(tied), Int32Array.from([3, 2, 1, 0]), 2, undefined, { trace: [{ angleDeg: 0, lowSeats: 1 }] }).traces;
    expect(Array.from(t!.order)).toEqual([0, 1, 2, 3]);
  });

  it('rejects a trace request for a candidate that is not evaluated', () => {
    const blocks = uShape();
    const ctx = createContext(blocks);
    expect(() => findCut(ctx, all(blocks.length), 2, undefined, { trace: [{ angleDeg: 180, lowSeats: 1 }] })).toThrow(/trace/);
    expect(() => findCut(ctx, all(blocks.length), 2, undefined, { trace: [{ angleDeg: -1, lowSeats: 1 }] })).toThrow(/trace/);
    expect(() => findCut(ctx, all(blocks.length), 2, undefined, { trace: [{ angleDeg: 0, lowSeats: 2 }] })).toThrow(/trace/);
  });

  describe('with a pool', () => {
    let pool: ScanPool;
    beforeAll(() => { pool = new ScanPool(2); });
    afterAll(async () => { await pool.close(); });

    it('trace runs on the calling thread when a pool is given', () => {
      const blocks = field();
      const ctx = createContext(blocks);
      const plain = findCut(ctx, all(blocks.length), 3);
      const pooled = findCut(ctx, all(blocks.length), 3, undefined, { pool, trace: every(plain) });
      sameResult(pooled, plain);
      const local = findCut(ctx, all(blocks.length), 3, undefined, { trace: every(plain) });
      expect(pooled.traces).toEqual(local.traces);
      expect(pooled.traces.length).toBe(wide(plain).length);
    });
  });
});
