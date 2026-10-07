import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Block } from '../../../src/server/entities/census-block/index.js';
import { createContext, findCut, ScanPool, type CutResult } from '../../../src/server/features/splitline/index.js';
import { gridBlocks } from '../../helpers/grid.js';

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
// The U shape from the re-count tests: the north-south line (k = 0) strands an arm and re-counts once.
const uShape = () => nudged(4, 5, (x, y) => (x === 1 && y === 1 ? 3 : 1), (x, y) => x >= 2 && y >= 1 && y <= 3);
// A U that cannot resolve: the north-south line stops unresolved.
const stuckU = () => nudged(4, 5, () => 1, (x, y) => x >= 2 && y >= 1 && y <= 3);
// An uneven seat count on a skewed grid gives two orientations and many angles.
const field = () => gridBlocks(7, 6, { pop: (x, y) => 1 + ((x * 3 + y * 5) % 7) });
const every = (r: CutResult) => r.candidateStats.map((s) => ({ k: s.k, lowSeats: s.lowSeats }));
const sameResult = (a: CutResult, b: CutResult) => {
  expect(sorted(a.low)).toEqual(sorted(b.low));
  expect(sorted(a.high)).toEqual(sorted(b.high));
  expect(a.angleDeg).toBe(b.angleDeg);
  expect(a.lengthM).toBe(b.lengthM);
  expect(a.candidateStats).toEqual(b.candidateStats);
};

describe('candidate trace', () => {
  it('trace leaves the result unchanged', () => {
    for (const [blocks, seats, step] of [[uShape(), 2, 90], [stuckU(), 2, 90], [field(), 3, 15]] as const) {
      const ctx = createContext(blocks, step);
      const plain = findCut(ctx, all(blocks.length), seats);
      const traced = findCut(ctx, all(blocks.length), seats, undefined, { trace: every(plain) });
      sameResult(traced, plain);
      expect(plain.traces).toEqual([]);
      expect(traced.traces.length).toBe(plain.candidateStats.length);
    }
  });

  it('trace of the winning candidate matches the result', () => {
    for (const [blocks, seats, step] of [[uShape(), 2, 90], [stuckU(), 2, 90], [field(), 3, 15]] as const) {
      const ctx = createContext(blocks, step);
      const r = findCut(ctx, all(blocks.length), seats);
      const k = Math.round((r.angleDeg * ctx.angleCount) / 180);
      const [t] = findCut(ctx, all(blocks.length), seats, undefined, { trace: [{ k, lowSeats: r.lowSeats }] }).traces;
      expect(t!.k).toBe(k);
      expect(t!.lowSeats).toBe(r.lowSeats);
      expect(t!.angleDeg).toBe(r.angleDeg);
      expect(sorted(t!.low)).toEqual(sorted(r.low));
      expect(sorted(t!.high)).toEqual(sorted(r.high));
      expect(t!.lengthM).toBe(r.lengthM);
      expect(t!.passes.at(-1)!.spans).toEqual(r.spans);
    }
  });

  it('trace passes end when nothing moves', () => {
    for (const [blocks, seats, step] of [[uShape(), 2, 90], [stuckU(), 2, 90], [field(), 3, 15]] as const) {
      const ctx = createContext(blocks, step);
      const plain = findCut(ctx, all(blocks.length), seats);
      const { traces } = findCut(ctx, all(blocks.length), seats, undefined, { trace: every(plain) });
      traces.forEach((t, i) => {
        const s = plain.candidateStats[i]!;
        expect(t.passes.length).toBe(s.iterations);
        const last = t.passes.at(-1)!;
        expect(last.moved.length === 0 || t.unresolved).toBe(true);
        expect(t.unresolved).toBe(s.unresolved);
        expect(t.lengthM).toBe(s.lengthM);
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
    const ctx = createContext(blocks, 90);
    const [t] = findCut(ctx, all(blocks.length), 2, undefined, { trace: [{ k: 0, lowSeats: 1 }] }).traces;
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
    const ctx = createContext(blocks, 90);
    const [t] = findCut(ctx, all(blocks.length), 2, undefined, { trace: [{ k: 0, lowSeats: 1 }] }).traces;
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
    const ctx = createContext(blocks, 90);
    const [t] = findCut(ctx, all(blocks.length), 2, undefined, { trace: [{ k: 0, lowSeats: 1 }] }).traces;
    expect(t!.unresolved).toBe(true);
    const last = t!.passes.at(-1)!;
    const stuck = last.sweeps.flatMap((s) => s.groups).filter((g) => !g.main && g.fixed.length > 0);
    expect(stuck.length).toBeGreaterThan(0);
    for (const g of stuck) for (const b of g.fixed) expect(last.moved.includes(b)).toBe(false);
  });

  it('walk order follows the direction with the block-id tie-break', () => {
    // k = 0 orders west to east.
    const row = gridBlocks(4, 1);
    const [w] = findCut(createContext(row, 90), Int32Array.from([2, 0, 3, 1]), 2, undefined, { trace: [{ k: 0, lowSeats: 1 }] }).traces;
    expect(Array.from(w!.order)).toEqual([0, 1, 2, 3]);
    // Blocks 1 and 2 share an internal point, so their keys tie and the lower block index walks first.
    const tied = gridBlocks(4, 1).map((b, i) => (i === 2 ? { ...b, point: row[1]!.point } : b));
    const [t] = findCut(createContext(tied, 90), Int32Array.from([3, 2, 1, 0]), 2, undefined, { trace: [{ k: 0, lowSeats: 1 }] }).traces;
    expect(Array.from(t!.order)).toEqual([0, 1, 2, 3]);
  });

  it('rejects a trace request for a candidate that is not evaluated', () => {
    const blocks = uShape();
    const ctx = createContext(blocks, 90);
    expect(() => findCut(ctx, all(blocks.length), 2, undefined, { trace: [{ k: 2, lowSeats: 1 }] })).toThrow(/trace/);
    expect(() => findCut(ctx, all(blocks.length), 2, undefined, { trace: [{ k: 0, lowSeats: 2 }] })).toThrow(/trace/);
  });

  describe('with a pool', () => {
    let pool: ScanPool;
    beforeAll(() => { pool = new ScanPool(2); });
    afterAll(async () => { await pool.close(); });

    it('trace runs on the calling thread when a pool is given', () => {
      const blocks = field();
      const ctx = createContext(blocks, 15);
      const plain = findCut(ctx, all(blocks.length), 3);
      const pooled = findCut(ctx, all(blocks.length), 3, undefined, { pool, trace: every(plain) });
      sameResult(pooled, plain);
      const local = findCut(ctx, all(blocks.length), 3, undefined, { trace: every(plain) });
      expect(pooled.traces).toEqual(local.traces);
      expect(pooled.traces.length).toBe(plain.candidateStats.length);
    });
  });
});
