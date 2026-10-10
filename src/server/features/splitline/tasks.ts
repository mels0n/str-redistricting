import type { Piece } from './scan.js';
import { sweepChunk, sweepSpan, type ChunkResult, type Dir } from './sweep.js';

/** What to sweep for one cut: every chunk of the half turn, once per first-side seat count. */
export interface SweepJob {
  readonly kind?: 'sweep';
  readonly seats: number;
  readonly orientations: readonly number[];
  /** Chunks per orientation; [0, 180) is cut into equal angles. The cut never depends on this number. */
  readonly chunks: number;
  /** Best ranges each chunk keeps. */
  readonly keep: number;
}

/** One tie stretch to sweep again on the piece turned half way round: directions [s, e) for one first-side seat count. */
export interface TieSpanTask {
  readonly lowSeats: number;
  readonly s: Dir;
  readonly e: Dir;
  readonly sDeg: number;
  readonly eDeg: number;
  readonly endIsPi: boolean;
}

/**
 * The tie stretches of one cut, swept again from the other end. Task t is stretch t, whole: a stretch is never cut
 * into pieces, since its first, last and best ranges are what the cut keeps of it.
 */
export interface TieSpanJob {
  readonly kind: 'tieSpan';
  readonly seats: number;
  readonly keep: number;
  readonly spans: readonly TieSpanTask[];
}

export type PoolJob = SweepJob | TieSpanJob;

/** One chunk: the first-side seat count and the angles [aDeg, bDeg). */
export interface SweepTask { readonly lowSeats: number; readonly aDeg: number; readonly bDeg: number }

/**
 * Task t of a job. Tasks are handed out in a strided order so that the heavy directions (long lines across dense
 * areas) are spread over the run instead of bunched at its end; which thread sweeps which chunk changes nothing.
 */
export function sweepTask(job: SweepJob, t: number): SweepTask {
  const total = job.orientations.length * job.chunks;
  const u = (t * stride(total)) % total;
  const o = Math.floor(u / job.chunks), c = u % job.chunks;
  return { lowSeats: job.orientations[o]!, aDeg: (180 * c) / job.chunks, bDeg: c === job.chunks - 1 ? 180 : (180 * (c + 1)) / job.chunks };
}

export const taskCount = (job: PoolJob): number => (job.kind === 'tieSpan' ? job.spans.length : job.orientations.length * job.chunks);

/** Run task t of a job on `piece`; the same on the calling thread and on a worker. */
export function runTask(piece: Piece, job: PoolJob, t: number): ChunkResult {
  if (job.kind === 'tieSpan') {
    const s = job.spans[t]!;
    return sweepSpan(piece, job.seats, s.lowSeats, s.s, s.e, s.sDeg, s.eDeg, s.endIsPi, job.keep, false);
  }
  const task = sweepTask(job, t);
  return sweepChunk(piece, job.seats, task.lowSeats, task.aDeg, task.bDeg, job.keep);
}

function stride(total: number): number {
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
  let s = 37;
  while (gcd(s, total) !== 1) s += 2;
  return s;
}

/** Chunks for a piece of m blocks: each chunk starts by building its trackers (work about m), so few, large chunks. */
export const chunksFor = (m: number): number => Math.min(1440, Math.max(64, Math.ceil(m / 2500)));
