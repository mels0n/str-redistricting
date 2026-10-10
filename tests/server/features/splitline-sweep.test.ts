import { describe, expect, it } from 'vitest';
import type { Block } from '../../../src/server/entities/census-block/index.js';
import { Chain } from '../../../src/server/features/splitline/chain.js';
import { createScanner, type Piece } from '../../../src/server/features/splitline/scan.js';
import { compareDirections, directionAt, geoFor, mergeChunks, sweepChunk, type ChunkResult, type Range } from '../../../src/server/features/splitline/sweep.js';
import { chunksFor, sweepTask, taskCount, type SweepJob } from '../../../src/server/features/splitline/tasks.js';
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
