import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createContext, findCut, ScanPool, splitState, type CutResult } from '../../../src/server/features/splitline/index.js';
import type { Piece } from '../../../src/server/features/splitline/scan.js';
import { chunksFor, runTask, taskCount, type PoolJob } from '../../../src/server/features/splitline/tasks.js';
import { WorkerPoolError } from '../../../src/server/shared/errors/index.js';
import { planWithoutCounters, withoutCounters } from '../../helpers/counters.js';
import { gridBlocks } from '../../helpers/grid.js';
import { pieceOf } from '../../helpers/piece.js';

const all = (n: number) => Int32Array.from({ length: n }, (_, i) => i);
const tieDyingUrl = new URL('../../helpers/tie-dying-scan-worker.ts', import.meta.url);
const settle = () => new Promise((r) => setTimeout(r, 300));

/** A small deterministic generator, so a failure reproduces. */
const lcg = (seed: number) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); };

type Fixture = { ctx: ReturnType<typeof createContext>; n: number; seats: number };

/**
 * Pieces with stopping-rule ties: small even populations and runs of empty blocks (a side can sit exactly on its
 * share with an empty block next to it), even seat counts (an integer target) and odd ones.
 */
function tiePieces(): Fixture[] {
  const rnd = lcg(11);
  const out: Fixture[] = [];
  for (let k = 0; k < 12; k++) {
    const w = 3 + Math.floor(rnd() * 4), h = 2 + Math.floor(rnd() * 3);
    const pops: number[] = Array.from({ length: w * h }, () => (rnd() < 0.35 ? 0 : 2 * Math.floor(rnd() * 3)));
    if (!pops.some((p) => p > 0)) pops[0] = 2;
    const ctx = createContext(gridBlocks(w, h, { pop: (x, y) => pops[y * w + x]! }));
    for (const seats of [2, 3, 4]) out.push({ ctx, n: w * h, seats });
  }
  return out;
}

const attempt = (f: () => CutResult): CutResult | string => {
  try { return f(); } catch (err) { return err instanceof Error ? `${err.constructor.name}: ${err.message}` : String(err); }
};
const comparable = (r: CutResult | string) => (typeof r === 'string' ? r : withoutCounters(r));
const withTies = (): Fixture => tiePieces().find((p) => { const r = attempt(() => findCut(p.ctx, all(p.n), p.seats)); return typeof r !== 'string' && r.tieSpans > 0; })!;

describe('tie stretches swept in the worker pool', () => {
  const pools = new Map<number, ScanPool>();
  const kinds: string[] = [];
  beforeAll(() => {
    for (const n of [1, 2, 4]) {
      const pool = new ScanPool(n);
      const scan = pool.scan.bind(pool);
      pool.scan = (piece: Piece, job: PoolJob) => { kinds.push(job.kind ?? 'sweep'); return scan(piece, job); };
      pools.set(n, pool);
    }
  });
  afterAll(async () => { for (const p of pools.values()) await p.close(); });

  it('gives the same cut on 1, 2 and 4 threads as on the calling thread, counters aside', () => {
    let spans = 0;
    for (const { ctx, n, seats } of tiePieces()) {
      const one = attempt(() => findCut(ctx, all(n), seats));
      if (typeof one !== 'string') spans += one.tieSpans;
      for (const [size, pool] of pools) {
        const many = attempt(() => findCut(ctx, all(n), seats, undefined, { pool }));
        expect(comparable(many), `${n} blocks, ${seats} seats, ${size} threads`).toEqual(comparable(one));
      }
    }
    // The fixtures do reach tie stretches, and the pool is the one that sweeps them.
    expect(spans).toBeGreaterThan(20);
    expect(kinds).toContain('tieSpan');
  }, 120_000);

  it('gives the same whole plan, counters aside', () => {
    const rnd = lcg(4);
    const pops: number[] = Array.from({ length: 48 }, () => (rnd() < 0.3 ? 0 : 1 + Math.floor(rnd() * 3)));
    const ctx = createContext(gridBlocks(8, 6, { pop: (x, y) => pops[y * 8 + x]! }));
    const one = splitState(ctx, 6);
    expect(one.cuts.reduce((s, c) => s + c.tieSpans, 0)).toBeGreaterThan(0);
    for (const pool of pools.values()) expect(planWithoutCounters(splitState(ctx, 6, { pool }))).toEqual(planWithoutCounters(one));
  }, 60_000);

  it('reports the scan counters of every cut, the same on any number of threads except the timing', () => {
    const { ctx, n, seats } = withTies();
    const one = findCut(ctx, all(n), seats);
    const many = findCut(ctx, all(n), seats, undefined, { pool: pools.get(4)! });
    for (const r of [one, many]) {
      expect(r.scan.tieSpanMs).toBeGreaterThanOrEqual(0);
      for (const k of ['derivedBuilds', 'reconfigs', 'exactFallbacks'] as const) expect(Number.isInteger(r.scan[k]), k).toBe(true);
    }
    const { tieSpanMs: _a, ...counted1 } = one.scan, { tieSpanMs: _b, ...countedN } = many.scan;
    expect(countedN).toEqual(counted1);
  });

  it('counts the tie stretches\' own sweeps, not only the chunks', () => {
    // A ragged outline with points off the lattice strands strays, so passes re-count and trackers are derived.
    const rnd = lcg(4);
    const pops = Array.from({ length: 48 }, () => (rnd() < 0.3 ? 0 : 1 + Math.floor(rnd() * 3)));
    const ctx = createContext(gridBlocks(8, 6, {
      pop: (x, y) => pops[y * 8 + x]!,
      skip: (x, y) => (x > 3 && x < 6 && y > 1) || (y === 4 && x > 6),
    }).map((b, i) => ({ ...b, point: [b.point[0] + ((i * 37) % 17 - 8) * 0.0004, b.point[1] + ((i * 53) % 19 - 9) * 0.0004] as const })));
    const n = ctx.blocks.length;
    const r = findCut(ctx, all(n), 2, undefined, { pool: pools.get(2)! });
    expect(r.tieSpans).toBeGreaterThan(0);
    const job = { seats: 2, orientations: [1], chunks: chunksFor(n), keep: 6 }, piece = pieceOf(ctx);
    let chunkOnly = 0;
    for (let t = 0; t < taskCount(job); t++) chunkOnly += runTask(piece, job, t).stats['derivedBuilds'] ?? 0;
    expect(chunkOnly).toBeGreaterThan(0);
    expect(r.scan.derivedBuilds).toBeGreaterThan(chunkOnly);
  });
});

describe('a worker lost while sweeping tie stretches', () => {
  it('fails as a pool error, and a fresh pool then gives the same cut as one thread', async () => {
    const { ctx, n, seats } = withTies();
    const dying = new ScanPool(2, { workerUrl: tieDyingUrl });
    expect(() => findCut(ctx, all(n), seats, undefined, { pool: dying })).toThrow(WorkerPoolError);
    expect(dying.broken).toBe(true);
    await settle();
    await dying.close();
    const fresh = new ScanPool(2);
    expect(withoutCounters(findCut(ctx, all(n), seats, undefined, { pool: fresh }))).toEqual(withoutCounters(findCut(ctx, all(n), seats)));
    await fresh.close();
  }, 30_000);
});
