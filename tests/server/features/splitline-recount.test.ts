import { describe, expect, it } from 'vitest';
import { isConnected, type Block } from '../../../src/server/entities/census-block/index.js';
import { createContext, findCut, splitState, type CandidateStat, type CutResult } from '../../../src/server/features/splitline/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';
import { gridBlocks } from '../../helpers/grid.js';

// Angle step 90 gives two directions: k = 0 orders blocks west to east (north-south guide line),
// k = 1 north to south (east-west guide line). Coordinates below are in units of 0.01 degree.
const u = 0.01;
const all = (n: number) => Int32Array.from({ length: n }, (_, i) => i);
const sorted = (a: Int32Array) => Array.from(a).sort((x, y) => x - y);
const stat = (r: CutResult, k: number): CandidateStat => r.candidateStats.find((c) => c.k === k)!;
const popOf = (blocks: readonly Block[], members: Int32Array) => Array.from(members).reduce((s, i) => s + blocks[i]!.pop, 0);
/** Grid of unit squares; internal points nudged east by 0.05 per row so west-to-east order is fixed. */
const nudged = (w: number, h: number, pop: (x: number, y: number) => number, skip: (x: number, y: number) => boolean) => {
  const blocks: Block[] = [];
  const at: [number, number][] = [];
  for (const b of gridBlocks(w, h, { pop, skip })) {
    const i = Number(b.geoid.slice(5));
    const x = i % w, y = Math.floor(i / w);
    blocks.push({ ...b, point: [(x + 0.5 + 0.05 * y) * u, (y + 0.5) * u] });
    at.push([x, y]);
  }
  return { blocks, idx: (x: number, y: number) => at.findIndex(([ax, ay]) => ax === x && ay === y) };
};

describe('strays and the re-count', () => {
  it('U shape: a stranded arm joins the low side, and the re-count gives back exactly what it brought', () => {
    // Columns 0 and 1 full height (y 0..4); arms east along y = 0 and y = 4. 16 people, target 8.
    // Whole blocks: low = column 0, (1,0), (1,1) = 9; the bottom arm (2 people) is cut off on the high
    // side and joins low (fixed). Recount over the rest: 2 + column 0 + (1,0) = 8 exactly, and
    // (1,0) keeps the arm attached.
    const { blocks, idx } = nudged(4, 5, (x, y) => (x === 1 && y === 1 ? 3 : 1), (x, y) => x >= 2 && y >= 1 && y <= 3);
    const r = findCut(createContext(blocks, 90), all(blocks.length), 2);
    const s = stat(r, 0);
    expect(s.iterations).toBe(2);
    expect(s.strayBlocks).toBe(2);
    expect(s.strayPop).toBe(2);
    expect(s.lowPop).toBe(8);
    expect(s.unresolved).toBe(false);
    expect(s.offsetShiftM).toBeLessThan(0);
    // The east-west line has the shorter border here; when north-south wins, these are its sides.
    if (r.angleDeg === 0) {
      expect(sorted(r.low)).toEqual([idx(0, 0), idx(0, 1), idx(0, 2), idx(0, 3), idx(0, 4), idx(1, 0), idx(2, 0), idx(3, 0)].sort((a, b) => a - b));
    }
    expect(popOf(blocks, r.low)).toBe(8);
    expect(isConnected(createContext(blocks, 90).topo, r.low)).toBe(true);
    expect(isConnected(createContext(blocks, 90).topo, r.high)).toBe(true);
  });

  it('a line that strands a piece is allowed, and loses to a line with a shorter real border', () => {
    // The same U. The north-south line strands the bottom arm, which joins the low side and lengthens
    // the border between the sides; the east-west line strands nothing and has the shorter border.
    const { blocks } = nudged(4, 5, (x, y) => (x === 1 && y === 1 ? 3 : 1), (x, y) => x >= 2 && y >= 1 && y <= 3);
    const r = findCut(createContext(blocks, 90), all(blocks.length), 2);
    expect(stat(r, 0).strayPop).toBe(2);
    expect(stat(r, 0).unresolved).toBe(false);
    expect(stat(r, 1).strayPop).toBe(0);
    expect(stat(r, 0).lengthM).toBeGreaterThan(stat(r, 1).lengthM);
    expect(r.angleDeg).toBe(90);
    expect(r.lengthM).toBe(stat(r, 1).lengthM);
  });

  it('U shape that cannot resolve stops with the arm stranded and falls through to a connected line', () => {
    // Same U, one person per block (14, target 7). After the bottom arm joins low the recount drops
    // (1,0), the arm's only link, so the arm (fixed) is stranded again; fixed blocks never move back,
    // so the candidate stops unresolved and the search moves on.
    const { blocks } = nudged(4, 5, () => 1, (x, y) => x >= 2 && y >= 1 && y <= 3);
    const ctx = createContext(blocks, 90);
    const r = findCut(ctx, all(blocks.length), 2);
    const s = stat(r, 0);
    expect(s.unresolved).toBe(true);
    expect(s.iterations).toBe(2);
    expect(s.iterations).toBeLessThanOrEqual(blocks.length);
    expect(isConnected(ctx.topo, r.low)).toBe(true);
    expect(isConnected(ctx.topo, r.high)).toBe(true);
  });

  it('straddling big block: the stray it encloses joins it and the split stays as close as whole blocks allow', () => {
    // A big block W (x 1..3, y 0..3) has a notch N on its top edge. W's internal point lies east of
    // N's, so whole blocks put N low and W high: N is a stray. Column L (x 0..1) and row B (y -1..0)
    // fill the low side; columns R and Q the east. 124 people, target 62.
    const P = (x: number, y: number) => [x * u, y * u] as const;
    const sq = (x: number, y: number) => [P(x, y), P(x + 1, y), P(x + 1, y + 1), P(x, y + 1), P(x, y)];
    let id = 0;
    const blk = (pop: number, point: readonly [number, number], ring: (readonly [number, number])[]): Block =>
      ({ geoid: '00000' + String(id++).padStart(10, '0'), pop, point: P(...point), rings: [ring] });
    const blocks: Block[] = [
      ...[0, 1, 2].map((y) => blk(10, [0.5, y + 0.5], sq(0, y))),
      ...[0, 1, 2, 3, 4].map((x) => blk(10, [x + 0.5, -0.5], sq(x, -1))),
      blk(10, [2.6, 1.5], [P(1, 0), P(2, 0), P(3, 0), P(3, 1), P(3, 2), P(3, 3), P(2, 3), P(2, 2.5), P(1.5, 2.5), P(1.5, 3), P(1, 3), P(1, 2), P(1, 1), P(1, 0)]),
      blk(4, [1.75, 2.75], [P(1.5, 2.5), P(2, 2.5), P(2, 3), P(1.5, 3), P(1.5, 2.5)]),
      ...[0, 1, 2].map((y) => blk(5, [3.5, y + 0.5], sq(3, y))),
      ...[0, 1, 2].map((y) => blk(5, [4.5, y + 0.5], sq(4, y))),
    ];
    const W = 8, N = 9;
    const ctx = createContext(blocks, 90);
    const r = findCut(ctx, all(blocks.length), 2);
    const s = stat(r, 0);
    expect(s.iterations).toBe(2);
    expect(s.strayBlocks).toBe(1);
    expect(s.strayPop).toBe(4);
    expect(s.lowPop).toBe(60);
    expect(s.unresolved).toBe(false);
    expect(s.offsetShiftM).toBe(0);
    if (r.angleDeg === 0) {
      expect(r.high.includes(N) && r.high.includes(W)).toBe(true);
      expect(popOf(blocks, r.low)).toBe(60);
    }
    expect(isConnected(ctx.topo, r.low)).toBe(true);
    expect(isConnected(ctx.topo, r.high)).toBe(true);
  });

  it('far peninsula: the stranded tip joins the far side and the guide line moves a column east', () => {
    // 4x4 square (y 0..3) plus a peninsula along y = 5 attached only at its east end through (3,4).
    // 21 people, target 10.5. Whole blocks: columns 0 and 1 low (10) including the tip (0,5), (1,5),
    // which joins high. Recount: columns 0 and 1 of the square plus (2,0), (2,1) = 10.
    const { blocks, idx } = nudged(4, 6, () => 1, (x, y) => (y === 4 && x < 3));
    const ctx = createContext(blocks, 90);
    const r = findCut(ctx, all(blocks.length), 2);
    const s = stat(r, 0);
    expect(s.iterations).toBe(2);
    expect(s.strayBlocks).toBe(2);
    expect(s.strayPop).toBe(2);
    expect(s.lowPop).toBe(10);
    expect(s.unresolved).toBe(false);
    expect(s.offsetShiftM).toBeGreaterThan(0.3 * u * 111_000);
    if (r.angleDeg === 0) {
      expect(sorted(r.low)).toEqual([0, 1, 2, 3].flatMap((y) => [idx(0, y), idx(1, y)]).concat([idx(2, 0), idx(2, 1)]).sort((a, b) => a - b));
    }
    expect(isConnected(ctx.topo, r.low)).toBe(true);
    expect(isConnected(ctx.topo, r.high)).toBe(true);
  });

  it('puts no limit on the size of a stray', () => {
    // Strip 0-1-2-3 with internal points placed so both lines strand block 3, which holds 11 people.
    const pts = [[0, 0.03], [0.001, 0.02], [0.03, 0], [0.002, 0.025]] as const;
    const blocks = gridBlocks(4, 1, { pop: (x) => [494, 495, 1000, 11][x]! }).map((b, i) => ({ ...b, point: pts[i]! }));
    const ctx = createContext(blocks, 90);
    const r = findCut(ctx, all(4), 2);
    expect(r.strayPopMoved).toBe(11);
    expect(r.skipped).toBe(0);
    expect(isConnected(ctx.topo, r.low)).toBe(true);
    expect(isConnected(ctx.topo, r.high)).toBe(true);
  });

  it('a stray moves once and stays; if the side it joined strands it, the line is unresolved and cannot be used', () => {
    // 7x5 grid. The 5x5 square on the left is three nested parts: the centre block C, the ring R1
    // around it, and the outer ring R2. The 2x5 strip on the right is H. Whole-block assignment puts
    // C and R2 low, R1 and H high (internal points placed to force it). On the low side C is a stray
    // and joins the high side, where it is fixed. On the high side R1 + C is not the main body (H holds
    // the people): R1 joins the low side, but C stays where it was fixed, stranded inside the low side.
    const w = 7, h = 5;
    const inSquare = (x: number) => x < 5;
    const ring = (x: number, y: number) => Math.max(Math.abs(x - 2), Math.abs(y - 2));
    const isLow = (x: number, y: number) => inSquare(x) && ring(x, y) !== 1;
    const hPops = [2, 2, 2, 2, 2, 2, 1, 1, 1, 1];
    let hIdx = 0;
    const base = gridBlocks(w, h, { pop: (x, y) => (!inSquare(x) ? hPops[hIdx++]! : ring(x, y) === 2 ? 1 : 0) });
    const blocks = base.map((b, i) => {
      const x = i % w, y = Math.floor(i / w);
      return { ...b, point: isLow(x, y) ? ([-0.05, 0.1] as const) : ([0.2, -0.1] as const) };
    });
    const ctx = createContext(blocks, 90);
    const centre = 2 * w + 2;
    // Accept any sides to look at the first-ranked line as it ended.
    const r = findCut(ctx, all(blocks.length), 2, () => true);
    expect(r.high.includes(centre)).toBe(true);
    expect(r.strayBlocksMoved).toBe(9);
    expect(r.iterations).toBe(2);
    expect(r.candidateStats.every((c) => c.unresolved)).toBe(true);
    expect(isConnected(ctx.topo, r.high)).toBe(false);
    // Neither line leaves two connected sides, so the search has nothing to use.
    expect(() => findCut(ctx, all(blocks.length), 2)).toThrow(DataError);
  });

  it('ends for every candidate within one population split per block, and a whole plan stays connected', () => {
    const blocks = gridBlocks(12, 9, { pop: (x, y) => 1 + ((x * 5 + y * 3) % 7), skip: (x, y) => x > 3 && x < 8 && y > 2 && y < 7 });
    const ctx = createContext(blocks, 1);
    const plan = splitState(ctx, 5);
    for (const c of plan.cuts) {
      expect(c.candidateStats).toHaveLength(c.candidateLines);
      for (const s of c.candidateStats) {
        expect(s.iterations).toBeGreaterThanOrEqual(1);
        expect(s.iterations).toBeLessThanOrEqual(blocks.length);
      }
    }
    for (let d = 0; d < 5; d++) {
      const members = Int32Array.from([...plan.assignment.keys()].filter((i) => plan.assignment[i] === d));
      expect(isConnected(ctx.topo, members)).toBe(true);
    }
  });
});
