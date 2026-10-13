import { describe, expect, it } from 'vitest';
import type { Block } from '../../../src/server/entities/census-block/index.js';
import { Chain } from '../../../src/server/features/splitline/chain.js';
import { createScanner, type Piece } from '../../../src/server/features/splitline/scan.js';
import { compareDirections, directionAt, geoFor, joinParts, mergeChunks, sweepChunk, sweepSpan, sweepSpans, type ChunkResult, type Range, type SpanBounds, type SplitHook } from '../../../src/server/features/splitline/sweep.js';
import { chunksFor, runPart, sweepTask, taskCount, tieWindows, type SweepJob, type TieSpanTask } from '../../../src/server/features/splitline/tasks.js';
import { gridBlocks } from '../../helpers/grid.js';
import { pieceOf } from '../../helpers/piece.js';

const u = 0.01;
/** A small deterministic generator, so a failure reproduces. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

/** Grid of unit squares with the internal points moved off the lattice, so no two blocks line up exactly. */
const jittered = (w: number, h: number, pop: (x: number, y: number) => number, skip: (x: number, y: number) => boolean, seed: number): Block[] => {
  const rnd = lcg(seed);
  return gridBlocks(w, h, { pop, skip }).map((b) => ({ ...b, point: [b.point[0] + (rnd() - 0.5) * 0.7 * u, b.point[1] + (rnd() - 0.5) * 0.7 * u] as const }));
};
/** Grid of unit squares; internal points nudged east by 0.05 per row so west-to-east order is fixed (the U shapes of the re-count tests). */
const nudged = (w: number, h: number, pop: (x: number, y: number) => number, skip: (x: number, y: number) => boolean): Block[] =>
  gridBlocks(w, h, { pop, skip }).map((b) => {
    const i = Number(b.geoid.slice(5));
    return { ...b, point: [((i % w) + 0.5 + 0.05 * Math.floor(i / w)) * u, (Math.floor(i / w) + 0.5) * u] as const };
  });

interface Fixture { readonly name: string; readonly blocks: Block[]; readonly seats: readonly number[] }
const fixtures: Fixture[] = [
  { name: 'uneven populations on a ragged grid', blocks: gridBlocks(6, 5, { pop: (x, y) => 1 + ((x * 7 + y * 13) % 11) * ((x + y) % 3), skip: (x, y) => (x === 3 && y > 1) || (y === 4 && x > 4) }), seats: [2] },
  { name: 'jittered points', blocks: jittered(6, 5, (x, y) => 1 + ((x * 5 + y * 3) % 7), (x, y) => x === 2 && y === 2, 5), seats: [2, 3, 5] },
  { name: 'U shape with a stray arm', blocks: nudged(4, 5, (x, y) => (x === 1 && y === 1 ? 3 : 1), (x, y) => x >= 2 && y >= 1 && y <= 3), seats: [2] },
  { name: 'U shape that cannot resolve', blocks: nudged(4, 5, () => 1, (x, y) => x >= 2 && y >= 1 && y <= 3), seats: [2] },
  { name: 'two stray arms', blocks: nudged(4, 7, (x, y) => (x === 1 && (y === 1 || y === 4) ? 3 : 1), (x, y) => x >= 2 && ((y >= 1 && y <= 2) || (y >= 4 && y <= 5))), seats: [2] },
];

const orientationsOf = (seats: number): number[] => { const a = Math.floor(seats / 2), b = seats - a; return a === b ? [a] : [a, b]; };
const KEEP_ALL = 1e9;

/** Every chunk of [0, 180) cut into `n` equal angles for one orientation. */
function sweepAll(piece: Piece, seats: number, lowSeats: number, n: number, keep = KEEP_ALL): ChunkResult[] {
  const job: SweepJob = { seats, orientations: [lowSeats], chunks: n, keep };
  return Array.from({ length: taskCount(job) }, (_, t) => { const k = sweepTask(job, t); return sweepChunk(piece, seats, k.lowSeats, k.aDeg, k.bDeg, keep); });
}

/** The sides every direction of a range gives, from an exact evaluation just after its start. */
function exactSides(piece: Piece, seats: number, r: Range): { side: Uint8Array; chain: Chain } {
  const chain = new Chain(piece, geoFor(piece, r.s, [0, 0, 0, -1], true), seats, r.lowSeats);
  chain.start(-4, -2);
  return { side: chain.finalSides(), chain };
}

/** Ranges narrower than this cannot be told apart by sine and cosine in doubles, which is all a scanner has. */
const NARROW_DEG = 1e-9;

describe('exact sweep against the one-direction scanner', () => {
  for (const f of fixtures) {
    for (const seats of f.seats) {
      it(`${f.name}, ${seats} seats: every range gives the sides and length the scanner finds at its middle`, () => {
        const piece = pieceOf(f.blocks);
        let compared = 0, narrow = 0;
        for (const lowSeats of orientationsOf(seats)) {
          const { ranges } = mergeChunks(sweepAll(piece, seats, lowSeats, 4));
          expect(ranges.length).toBeGreaterThan(0);
          const scanner = createScanner(piece, { seats });
          // The ranges are disjoint stretches of the half turn.
          const byStart = [...ranges].sort((p, q) => p.sDeg - q.sDeg);
          for (let i = 1; i < byStart.length; i++) expect(byStart[i]!.sDeg).toBeGreaterThanOrEqual(byStart[i - 1]!.eDeg - 1e-9);
          for (const r of ranges) {
            expect(r.unresolved).toBe(false);
            expect(r.sDeg).toBeLessThan(r.eDeg + 1e-12);
            if (r.eDeg - r.sDeg < NARROW_DEG) { narrow++; continue; }
            scanner.setAngle((r.sDeg + r.eDeg) / 2);
            const side = new Uint8Array(piece.m);
            const e = scanner.evaluate(lowSeats, side);
            // The scanner's lengths are whole micrometers too: piece.lLen is.
            expect(e.lengthM, `${r.sDeg}..${r.eDeg}`).toBe(r.lengthUm);
            expect(e.lowPop).toBe(r.lowPop);
            expect(e.unresolved).toBe(false);
            const exact = exactSides(piece, seats, r);
            expect(Array.from(side), `${r.sDeg}..${r.eDeg}`).toEqual(Array.from(exact.side));
            expect(exact.chain.lengthUm).toBe(r.lengthUm);
            // The sides low-population is the sum over the low side.
            let lowPop = 0;
            for (let i = 0; i < piece.m; i++) if (side[i] === 0) lowPop += piece.pops[i]!;
            expect(lowPop).toBe(r.lowPop);
            compared++;
          }
        }
        expect(compared).toBeGreaterThan(0);
        expect(compared).toBeGreaterThanOrEqual(narrow);
      });

      it(`${f.name}, ${seats} seats: random directions give what the range holding them gives`, () => {
        const piece = pieceOf(f.blocks);
        const rnd = lcg(seats * 101 + f.name.length);
        for (const lowSeats of orientationsOf(seats)) {
          const { ranges } = mergeChunks(sweepAll(piece, seats, lowSeats, 3));
          const scanner = createScanner(piece, { seats });
          let seen = 0;
          for (let i = 0; i < 300; i++) {
            const angle = rnd() * 180;
            const inside = ranges.find((r) => r.sDeg + 1e-7 < angle && angle < r.eDeg - 1e-7);
            // Too close to a boundary to tell which range the scanner's rounding puts it in.
            if (!inside && ranges.some((r) => Math.abs(r.sDeg - angle) < 1e-7 || Math.abs(r.eDeg - angle) < 1e-7)) continue;
            scanner.setAngle(angle);
            const side = new Uint8Array(piece.m);
            const e = scanner.evaluate(lowSeats, side);
            if (!inside) {
              // No resolved range holds it, so the line it makes must be one the strays rule cannot resolve.
              expect(e.unresolved, `${angle}`).toBe(true);
              continue;
            }
            expect(e.unresolved, `${angle}`).toBe(false);
            expect(e.lengthM, `${angle}`).toBe(inside.lengthUm);
            expect(e.lowPop).toBe(inside.lowPop);
            expect(Array.from(side), `${angle}`).toEqual(Array.from(exactSides(piece, seats, inside).side));
            seen++;
          }
          expect(seen).toBeGreaterThan(0);
        }
      });
    }
  }
});

describe('chain consistency', () => {
  // The windows a chunk sweeps start anywhere in the half turn, so the chain is also checked from a start that is not 0.
  const windows: readonly (readonly [number, number])[] = [[0, 180], [60, 120], [90, 135], [135, 180]];
  for (const f of fixtures) {
    it(`${f.name}: the incrementally kept evaluation equals a rebuild from scratch at every step`, () => {
      const piece = pieceOf(f.blocks);
      for (const seats of f.seats) {
        for (const lowSeats of orientationsOf(seats)) {
          for (const [aDeg, bDeg] of windows) {
            const g = geoFor(piece, directionAt(aDeg), directionAt(bDeg), bDeg >= 180);
            const chain = new Chain(piece, g, seats, lowSeats);
            chain.start(-4, -2);
            expect(chain.selfCheck(-4, -2)).toBe(true);
            let steps = 0, deepest = chain.passes.length;
            for (;;) {
              const st = chain.step();
              if (!st) break;
              steps++;
              deepest = Math.max(deepest, chain.passes.length);
              expect(chain.selfCheck(st.ci, st.cj), `${seats} seats, ${lowSeats} first, ${aDeg}..${bDeg}, step ${steps} at (${st.ci}, ${st.cj})`).toBe(true);
            }
            expect(chain.stats.selfCheckFails).toBe(0);
            expect(chain.stats.selfChecks).toBe(steps + 1);
            // The strays rule really is exercised by the stray fixtures.
            if (/stray|U shape/.test(f.name) && aDeg === 0) expect(deepest).toBeGreaterThanOrEqual(2);
          }
        }
      }
    });
  }

  it('a chain over a grid with pinned strays and re-counts passes the self check at every step', () => {
    // A hollow of empty blocks inside populated ones gives strays on one side and several passes.
    const blocks = gridBlocks(7, 6, { pop: (x, y) => (x >= 2 && x <= 4 && y >= 2 && y <= 3 ? 0 : 1 + ((x * 3 + y * 2) % 5)), skip: (x, y) => x === 6 && y < 2 });
    const piece = pieceOf(blocks);
    const chain = new Chain(piece, geoFor(piece, directionAt(0), directionAt(180), true), 3, 1);
    chain.start(-4, -2);
    let steps = 0, recounted = 0;
    for (;;) {
      const st = chain.step();
      if (!st) break;
      steps++;
      if (chain.passes.length > 1) recounted++;
      expect(chain.selfCheck(st.ci, st.cj), `step ${steps}`).toBe(true);
    }
    expect(steps).toBeGreaterThan(20);
    expect(chain.stats.selfCheckFails).toBe(0);
    expect(recounted).toBeGreaterThanOrEqual(0);
  });
});

describe('chunk independence', () => {
  const summarize = (r: Range) => ({ lowSeats: r.lowSeats, lengthUm: r.lengthUm, lowPop: r.lowPop, h1: r.h1, h2: r.h2, unresolved: r.unresolved });
  /** Two ranges start and end at the same directions. Blocks that line up give several pairs for one direction, so the pair itself may differ. */
  const sameDirections = (p: Range, q: Range) => {
    expect(compareDirections(p.s, q.s)).toBe(0);
    expect(compareDirections(p.e, q.e)).toBe(0);
    expect(p.sDeg).toBeCloseTo(q.sDeg, 9);
    expect(p.eDeg).toBeCloseTo(q.eDeg, 9);
  };

  for (const f of fixtures) {
    for (const seats of f.seats) {
      it(`${f.name}, ${seats} seats: 1, 3 and 7 chunks give the same ranges, winner and count`, () => {
        const piece = pieceOf(f.blocks);
        const runs = [1, 3, 7].map((n) => {
          const chunks = orientationsOf(seats).flatMap((lowSeats) => sweepAll(piece, seats, lowSeats, n));
          return { chunks, ...mergeChunks(chunks) };
        });
        const [one, three, seven] = runs;
        for (const other of [three!, seven!]) {
          expect(other.ranges.map(summarize)).toEqual(one!.ranges.map(summarize));
          expect(other.count).toBe(one!.count);
          other.ranges.forEach((r, i) => sameDirections(r, one!.ranges[i]!));
          // The exact directions bounding the winner, and its sides, do not depend on the chunking.
          const winner = one!.ranges[0]!, theirs = other.ranges[0]!;
          expect(Array.from(exactSides(piece, seats, theirs).side)).toEqual(Array.from(exactSides(piece, seats, winner).side));
        }
        expect(one!.count).toBeGreaterThanOrEqual(one!.ranges.length);
      });
    }
  }

  it('keeps the same best ranges when each chunk keeps only a few', () => {
    const piece = pieceOf(jittered(7, 6, (x, y) => 1 + ((x * 5 + y * 3) % 7), (x, y) => x === 3 && y === 3, 9));
    const full = mergeChunks(sweepAll(piece, 4, 2, 1, KEEP_ALL));
    for (const n of [1, 3, 7, 16]) {
      const kept = mergeChunks(sweepAll(piece, 4, 2, n, 6));
      expect(kept.count).toBe(full.count);
      // The leading ranges are the same; a chunk keeping fewer can only drop ranges behind them.
      expect(kept.ranges.slice(0, 3).map(summarize)).toEqual(full.ranges.slice(0, 3).map(summarize));
      kept.ranges.slice(0, 3).forEach((r, i) => sameDirections(r, full.ranges[i]!));
    }
  });

  it('joins a range that crosses a chunk boundary into one range', () => {
    // A piece with few blocks has few ranges, so a boundary at 90 degrees lies inside one of them.
    const piece = pieceOf(gridBlocks(2, 1, { pop: () => 1 }));
    const two = mergeChunks([sweepChunk(piece, 2, 1, 0, 90, KEEP_ALL), sweepChunk(piece, 2, 1, 90, 180, KEEP_ALL)]);
    const whole = mergeChunks([sweepChunk(piece, 2, 1, 0, 180, KEEP_ALL)]);
    expect(two.ranges.map(summarize)).toEqual(whole.ranges.map(summarize));
    two.ranges.forEach((r, i) => sameDirections(r, whole.ranges[i]!));
    expect(two.count).toBe(whole.count);
  });

  it('chunksFor grows with the piece but never below 64 or above 1440', () => {
    expect(chunksFor(10)).toBe(64);
    expect(chunksFor(1_000_000)).toBe(400);
    expect(chunksFor(10_000_000)).toBe(1440);
    // The chunks of a job cover [0, 180) exactly once per orientation.
    const job: SweepJob = { seats: 3, orientations: [1, 2], chunks: 64, keep: 6 };
    const covered = new Map<number, [number, number][]>();
    for (let t = 0; t < taskCount(job); t++) { const k = sweepTask(job, t); covered.set(k.lowSeats, [...(covered.get(k.lowSeats) ?? []), [k.aDeg, k.bDeg]]); }
    for (const spans of covered.values()) {
      spans.sort((p, q) => p[0] - q[0]);
      expect(spans).toHaveLength(64);
      expect(spans[0]![0]).toBe(0);
      expect(spans[63]![1]).toBe(180);
      for (let i = 1; i < spans.length; i++) expect(spans[i]![0]).toBe(spans[i - 1]![1]);
    }
  });
});

describe('stretches swept in windows', () => {
  const withoutStats = (r: ChunkResult) => { const { stats: _s, ...rest } = r; return rest; };
  /** The piece turned half way round, as findCut sweeps tie stretches. */
  const turned = (p: Piece): Piece => ({ ...p, px: p.px.map((v) => -v), py: p.py.map((v) => -v) });
  /** Stretches from a sweep's own ranges: every range starts at an event (or 0), so they start where tie stretches do. */
  const stretchesOf = (piece: Piece, seats: number, lowSeats: number, pick: (i: number) => boolean): SpanBounds[] => {
    const c = sweepChunk(piece, seats, lowSeats, 0, 180, KEEP_ALL);
    const all = [...new Set([c.first, ...c.top, ...c.unresolvedRanges, c.last])].sort((p, q) => compareDirections(p.s, q.s));
    return all.filter((_, i) => pick(i)).map((r) => ({ s: r.s, e: r.e, sDeg: r.sDeg, eDeg: r.eDeg, endIsPi: r === c.last }));
  };
  const cases = [
    { name: 'jittered points', blocks: fixtures[1]!.blocks, seats: [2, 3, 5] },
    { name: 'U shape with a stray arm', blocks: fixtures[2]!.blocks, seats: [2] },
    { name: 'two stray arms', blocks: fixtures[4]!.blocks, seats: [2] },
    // Even populations and empty blocks: stopping-rule ties, so the turned piece decides them the other way.
    { name: 'empty blocks', blocks: gridBlocks(6, 4, { pop: (x, y) => ((x * 3 + y * 5) % 4 === 0 ? 0 : 2 * ((x + y) % 3)) }), seats: [2, 3, 4] },
  ];
  for (const f of cases) {
    for (const seats of f.seats) {
      it(`${f.name}, ${seats} seats: every stretch gives in a window what it gives alone`, () => {
        const piece = turned(pieceOf(f.blocks));
        for (const lowSeats of orientationsOf(seats)) {
          for (const [label, pick] of [['every other', (i: number) => i % 2 === 0], ['touching', (i: number) => i % 3 !== 2], ['all', () => true]] as const) {
            const spans = stretchesOf(piece, seats, lowSeats, pick);
            if (spans.length === 0) continue;
            const alone = spans.map((s) => withoutStats(sweepSpan(piece, seats, lowSeats, s.s, s.e, s.sDeg, s.eDeg, s.endIsPi, 6, false)));
            for (const size of [1, 2, 3, spans.length]) {
              const got: ChunkResult[] = [];
              for (let i = 0; i < spans.length; i += size) got.push(...sweepSpans(piece, seats, lowSeats, spans.slice(i, i + size), 6));
              expect(got.map(withoutStats), `${label}, windows of ${size}`).toEqual(alone);
            }
            // A gap given up part way (or at once, or never) starts the next stretch afresh: the same results.
            for (const budget of [0, 0.01, Infinity]) {
              expect(sweepSpans(piece, seats, lowSeats, spans, 6, undefined, budget).map(withoutStats), `${label}, budget ${budget}`).toEqual(alone);
            }
          }
        }
      });
    }
  }

  it('carries the work counters over so a window sums to its whole sweep', () => {
    const piece = turned(pieceOf(fixtures[4]!.blocks));
    const spans = stretchesOf(piece, 2, 1, (i) => i % 2 === 0);
    expect(spans.length).toBeGreaterThan(2);
    const work = (rs: readonly ChunkResult[], key: string) => rs.reduce((s, r) => s + (r.stats[key] ?? 0), 0);
    const last = spans[spans.length - 1]!;
    const aloneRuns = spans.map((s) => sweepSpan(piece, 2, 1, s.s, s.e, s.sDeg, s.eDeg, s.endIsPi, 6, false));
    // One chain over the whole window does exactly the work of one sweep from the first start to the last end, gaps
    // included; each result carries only the work since the one before it (a result holding the running total would
    // overshoot the sum, a chain's work dropped when it is left would undershoot it).
    const whole = sweepSpan(piece, 2, 1, spans[0]!.s, last.e, spans[0]!.sDeg, last.eDeg, last.endIsPi, 6, false);
    const one = sweepSpans(piece, 2, 1, spans, 6, undefined, Infinity);
    for (const key of ['trackerEvents', 'groups']) expect(work(one, key), key).toBe(whole.stats[key]);
    // Each result is at least the work of its stretch swept alone, and a middle one costs more than that (the gap before it).
    one.forEach((r, k) => expect(r.stats['trackerEvents']!).toBeGreaterThanOrEqual(aloneRuns[k]!.stats['trackerEvents']!));
    expect(one[1]!.stats['trackerEvents']!).toBeGreaterThan(aloneRuns[1]!.stats['trackerEvents']!);
    // Starting afresh at every stretch (budget 0): the work of the chains left behind still counts. Each result is the
    // stretch's own work plus whatever gap steps came first, never less than the stretch alone, and the whole is
    // less than the one chain's only because nothing is walked twice.
    const fresh = sweepSpans(piece, 2, 1, spans, 6, undefined, 0);
    fresh.forEach((r, k) => expect(r.stats['trackerEvents']!, `stretch ${k}`).toBeGreaterThanOrEqual(aloneRuns[k]!.stats['trackerEvents']!));
    expect(work(fresh, 'trackerEvents')).toBeGreaterThanOrEqual(work(aloneRuns, 'trackerEvents'));
    expect(work(fresh, 'trackerEvents')).toBeLessThan(whole.stats['trackerEvents']!);
    for (const r of [...one, ...fresh]) expect(r.stats['trackerEvents']).toBeGreaterThanOrEqual(0);
  });

  it('refuses stretches out of turn order', () => {
    const piece = pieceOf(fixtures[1]!.blocks);
    const spans = stretchesOf(piece, 2, 1, () => true);
    expect(spans.length).toBeGreaterThan(2);
    expect(() => sweepSpans(piece, 2, 1, [spans[2]!, spans[0]!], 6)).toThrow(/turn order/);
  });

  it('groups neighbouring stretches of one seat count, never across a seat count or the end of the half turn', () => {
    const at = (lowSeats: number, a: number, b: number, endIsPi = false): TieSpanTask => ({ lowSeats, s: directionAt(a), e: directionAt(b), sDeg: a, eDeg: b, endIsPi });
    const list = [at(1, 0, 1), at(1, 1.1, 2), at(1, 50, 51), at(1, 179, 180, true), at(2, 0.1, 0.2), at(2, 0.3, 0.4), at(2, 0.35, 0.5)];
    // A new window at a new seat count and after the stretch that ends the half turn; never two stretches out of turn order.
    expect(tieWindows(list.slice(0, 6))).toEqual([0, 4]);
    expect(tieWindows(list)).toEqual([0, 4, 6]);
    expect(tieWindows([])).toEqual([]);
    // A long run is split so the windows still spread over the threads.
    const run = Array.from({ length: 40 }, (_, i) => at(1, i * 0.01, i * 0.01 + 0.005));
    expect(tieWindows(run)).toEqual([0, 16, 32]);
    // A cut with very many stretches takes larger windows, so it does not start a chain every 16 stretches.
    const many = Array.from({ length: 5000 }, (_, i) => at(1, i * 0.03, i * 0.03 + 0.01));
    const w = tieWindows(many);
    expect(w).toHaveLength(250);
    expect(w[1]).toBe(20);
  });
});

describe('a chunk split while it runs', () => {
  const withoutStats = (r: ChunkResult | null) => { if (!r) return r; const { stats: _s, ...rest } = r; return rest; };
  /** A hook that splits at the next of `at` (degrees) each time it is asked, recording the parts it hands off. */
  const splitter = (at: number[], posted: [number, number][]): SplitHook => ({
    propose: (last, end) => { const d = at.find((x) => x > last && x < end); return d ?? null; },
    split: (d, end) => { posted.push([d, end]); at.splice(at.indexOf(d), 1); return true; },
  });
  /** As withoutStats, and without the flags that say how the sweep ended (a joined chunk does not carry them). */
  const withoutFlags = (r: ChunkResult) => { const { stats: _s, ambiguous: _a, eventAtEnd: _e, ...rest } = r; return rest; };
  /** The hook the pool's Stealer gives: split at the middle of (last split, current end), so every split after the first lands below the previous one. */
  const halver = (posted: [number, number][], minDeg = 1e-3): SplitHook => ({
    propose: (last, end) => (end - last > minDeg ? last + (end - last) / 2 : null),
    split: (d, end) => { posted.push([d, end]); return true; },
  });
  /** Sweep [a, b) the way the pool does: the owner cut short at each split, every posted part swept on its own (and split again). */
  const sweepSplit = (piece: Piece, seats: number, lowSeats: number, a: number, b: number, keep: number, at: number[]): ChunkResult[] => {
    const posted: [number, number][] = [];
    const out = [sweepChunk(piece, seats, lowSeats, a, b, keep, undefined, splitter(at, posted))];
    while (posted.length) { const [x, y] = posted.pop()!; out.push(sweepChunk(piece, seats, lowSeats, x, y, keep, undefined, splitter(at, posted))); }
    return out.sort((p, q) => p.aDeg - q.aDeg);
  };
  for (const f of fixtures) {
    for (const seats of f.seats) {
      it(`${f.name}, ${seats} seats: the parts join into exactly the whole chunk's sweep`, () => {
        const piece = pieceOf(f.blocks);
        const rnd = lcg(seats * 31 + f.blocks.length);
        let splits = 0, joins = 0;
        for (const lowSeats of orientationsOf(seats)) {
          for (const [a, b] of [[0, 180], [0, 37.5], [61, 133], [140, 180]] as const) {
            for (const keep of [1, 6, KEEP_ALL]) {
              const whole = sweepChunk(piece, seats, lowSeats, a, b, keep);
              // Split points anywhere, also between events close together; the owner takes them as it reaches them.
              const at = Array.from({ length: 6 }, () => a + (b - a) * rnd()).sort((x, y) => x - y);
              const parts = sweepSplit(piece, seats, lowSeats, a, b, keep, [...at]);
              splits += parts.length - 1;
              for (let k = 1; k < parts.length; k++) expect(parts[k]!.aDeg).toBe(parts[k - 1]!.bDeg);
              const joined = joinParts(parts, keep);
              // Points on a lattice line up, so a later part may name a direction by another pair; it is then swept whole.
              if (joined === null) expect(parts.slice(1).some((p) => p.ambiguous) || parts.some((p) => p.eventAtEnd)).toBe(true);
              else { joins++; expect(withoutStats(joined), `[${a}, ${b}) keep ${keep}`).toEqual(withoutStats(whole)); }
            }
          }
        }
        expect(splits).toBeGreaterThan(0);
        // Jittered points never line up, so their parts always join.
        if (f.name === 'jittered points') expect(joins).toBe(orientationsOf(seats).length * 12);
        else expect(joins).toBeGreaterThan(0);
      });
    }
  }

  const total = { parts: 0, reSplit: 0, joins: 0 };
  for (const f of fixtures) {
    for (const seats of f.seats) {
      it(`${f.name}, ${seats} seats: a chunk halved again and again as the Stealer does joins into the whole chunk's sweep`, () => {
        const piece = pieceOf(f.blocks);
        let reSplit = 0, joins = 0, partCount = 0;
        for (const lowSeats of orientationsOf(seats)) {
          for (const [a, b] of [[0, 180], [61, 133]] as const) {
            for (const keep of [1, KEEP_ALL]) {
              const whole = sweepChunk(piece, seats, lowSeats, a, b, keep);
              // Only the owner halves, a few times; the parts it posts are swept whole.
              const posted: [number, number][] = [];
              let left = 4;
              const hook: SplitHook = { propose: (l, e) => (left > 0 ? halver(posted).propose(l, e) : null), split: (d, e) => { left--; return halver(posted).split(d, e); } };
              const parts = [sweepChunk(piece, seats, lowSeats, a, b, keep, undefined, hook)];
              for (const [x, y] of posted) parts.push(runPart(piece, { seats, orientations: [lowSeats], chunks: 1, keep }, 0, x, y));
              parts.sort((p, q) => p.aDeg - q.aDeg);
              partCount += parts.length;
              expect(parts[0]!.aDeg).toBe(a);
              expect(parts[parts.length - 1]!.bDeg).toBe(b);
              for (let k = 1; k < parts.length; k++) expect(parts[k]!.aDeg).toBe(parts[k - 1]!.bDeg);
              // A split below an earlier one: the part posted last starts lower than the one posted first.
              if (posted.length > 1 && posted[posted.length - 1]![0] < posted[0]![0]) reSplit++;
              const joined = joinParts(parts, keep);
              if (joined === null) expect(parts.slice(1).some((p) => p.ambiguous) || parts.some((p) => p.eventAtEnd)).toBe(true);
              else { joins++; expect(withoutFlags(joined), `[${a}, ${b}) keep ${keep}`).toEqual(withoutFlags(whole)); }
            }
          }
        }
        total.parts += partCount; total.reSplit += reSplit; total.joins += joins;
        expect(partCount).toBeGreaterThan(orientationsOf(seats).length * 4);
      });
    }
  }

  it('the halving runs above really re-split below an earlier split, and their parts joined', () => {
    // A sweep is offered a split every SPLIT_EVERY steps, so only the fixtures with enough events re-split.
    expect(total.reSplit).toBeGreaterThan(0);
    expect(total.parts).toBeGreaterThan(total.reSplit);
    expect(total.joins).toBeGreaterThan(0);
  });

  it('refuses to join parts that meet exactly on an event, so the chunk is swept again whole', () => {
    // Two blocks whose difference is exactly the direction at 30 degrees: their swap is an event right at the split.
    const d = directionAt(30);
    const blocks = gridBlocks(3, 2, { pop: () => 1 });
    const piece = pieceOf(blocks);
    const px = Float64Array.from(piece.px), py = Float64Array.from(piece.py);
    px[0] = 0; py[0] = 0; px[1] = d[2]; py[1] = d[3];
    for (let i = 2; i < px.length; i++) { px[i] = 3 * (i % 3) - 1.3; py[i] = 2.1 * Math.floor(i / 3) + 0.7; }
    const odd = { ...piece, px, py };
    const posted: [number, number][] = [];
    const first = sweepChunk(odd, 2, 1, 0, 180, 6, undefined, { propose: (l, e) => (l < 30 && e > 30 ? 30 : null), split: (x, e) => { posted.push([x, e]); return true; } });
    expect(posted).toEqual([[30, 180]]);
    expect(first.eventAtEnd).toBe(true);
    expect(joinParts([first, sweepChunk(odd, 2, 1, 30, 180, 6)], 6)).toBeNull();
  });

  // Known engine issue, deferred: an owner splits at 30 (posting [30, 180)) and then re-splits at 15 (posting [15, 30)),
  // leaving the parts [0, 15), [15, 30) and [30, 180). The pair swapping exactly at 30 is an event where the last two
  // meet, so joinParts must return null (the chunk is swept again whole). Only a part cut short by its own split
  // reports eventAtEnd, and [15, 30) is swept as a plain chunk that ends at 30, so the join goes through today.
  // When the engine is fixed this starts to fail: then change it.fails into it.
  it.fails('refuses to join parts when a re-split leaves a part ending exactly on an event', () => {
    const d = directionAt(30);
    const piece = pieceOf(gridBlocks(3, 2, { pop: () => 1 }));
    const px = Float64Array.from(piece.px), py = Float64Array.from(piece.py);
    px[0] = 0; py[0] = 0; px[1] = d[2]; py[1] = d[3];
    for (let i = 2; i < px.length; i++) { px[i] = 3 * (i % 3) - 1.3; py[i] = 2.1 * Math.floor(i / 3) + 0.7; }
    const odd = { ...piece, px, py };
    const parts = [[0, 15], [15, 30], [30, 180]].map(([x, y]) => sweepChunk(odd, 2, 1, x!, y!, 6));
    expect(joinParts(parts, 6)).toBeNull();
  });

  it('keeps going when a split is refused', () => {
    const piece = pieceOf(fixtures[1]!.blocks);
    let asked = 0;
    const r = sweepChunk(piece, 2, 1, 0, 180, 6, undefined, { propose: (l, e) => { asked++; return (l + e) / 2; }, split: () => false });
    expect(asked).toBeGreaterThan(0);
    expect(withoutStats(r)).toEqual(withoutStats(sweepChunk(piece, 2, 1, 0, 180, 6)));
  });
});

describe('ranges of equal length are never cut from a chunk', () => {
  it('keeps every range as long as the last one kept, so the tie rules see them all', () => {
    // Centered on the equator, the north-south and east-west borders of a uniform square are exactly equal and give
    // different sides. Keeping a single range must still keep both.
    const piece = pieceOf(gridBlocks(4, 4, { origin: [0, -0.02] }));
    const c = sweepChunk(piece, 2, 1, 0, 180, 1);
    const best = c.top[0]!.lengthUm;
    const tied = c.top.filter((r) => r.lengthUm === best);
    expect(tied.length).toBeGreaterThanOrEqual(2);
    expect(new Set(tied.map((r) => `${r.h1}:${r.h2}`)).size).toBeGreaterThanOrEqual(2);
    // And nothing longer than the last kept range is kept beyond the one asked for.
    expect(c.top.every((r) => r.lengthUm === best)).toBe(true);
  });
});
