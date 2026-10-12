import type { Piece } from './scan.js';
import { compareDirections, sweepChunk, sweepSpans, type ChunkResult, type Dir, type SplitHook } from './sweep.js';

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
 * The tie stretches of one cut, swept again from the other end. A stretch is never cut into pieces, since its first,
 * last and best ranges are what the cut keeps of it. Task t is a window of neighbouring stretches, spans[windows[t]]
 * up to spans[windows[t + 1]] (or the last), swept in order with one chain (sweepSpans); the results are one per
 * stretch, in stretch order, the same however the stretches are grouped.
 */
export interface TieSpanJob {
  readonly kind: 'tieSpan';
  readonly seats: number;
  readonly keep: number;
  readonly spans: readonly TieSpanTask[];
  /** Index of each window's first stretch, ascending from 0. */
  readonly windows: readonly number[];
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

export const taskCount = (job: PoolJob): number => (job.kind === 'tieSpan' ? job.windows.length : job.orientations.length * job.chunks);

/**
 * Run task t of a job on `piece`; the same on the calling thread and on a worker. A chunk gives one result, a window
 * of tie stretches one per stretch. `beat` is the worker's heartbeat (see sweepSpan) and `split` lets a chunk hand
 * part of its directions to another thread (steal.ts); neither changes a result.
 */
export function runTask(piece: Piece, job: PoolJob, t: number, beat?: () => void, split?: SplitHook): ChunkResult[] {
  if (job.kind === 'tieSpan') {
    const spans = job.spans.slice(job.windows[t], job.windows[t + 1] ?? job.spans.length);
    return sweepSpans(piece, job.seats, spans[0]!.lowSeats, spans, job.keep, beat);
  }
  const task = sweepTask(job, t);
  return [sweepChunk(piece, job.seats, task.lowSeats, task.aDeg, task.bDeg, job.keep, beat, split)];
}

/** Directions [fromDeg, toDeg) of chunk t, a part another thread split off (steal.ts). */
export function runPart(piece: Piece, job: SweepJob, t: number, fromDeg: number, toDeg: number, beat?: () => void, split?: SplitHook): ChunkResult {
  return sweepChunk(piece, job.seats, sweepTask(job, t).lowSeats, fromDeg, toDeg, job.keep, beat, split);
}

/** Most tie stretches in one window, so the windows of a cut still spread over the threads. */
export const WINDOW_SPANS = 16;

/**
 * Where each window of tie stretches starts (TieSpanJob.windows): runs of up to WINDOW_SPANS stretches of one
 * first-side seat count, in turn order. A window carries one chain from stretch to stretch and gives up a gap that
 * costs more than a fresh start (sweepSpans), so grouping is speed only, never a change to a map: each stretch gives
 * the same result in any window.
 */
export function tieWindows(spans: readonly TieSpanTask[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < spans.length; i++) {
    const p = spans[i - 1], s = spans[i]!;
    const join = p !== undefined && i - out[out.length - 1]! < WINDOW_SPANS && p.lowSeats === s.lowSeats && !p.endIsPi && compareDirections(p.e, s.s) <= 0;
    if (!join) out.push(i);
  }
  return out;
}

/**
 * A step through the task list that shares no factor with its length, so walking it visits every task once. Starts
 * at 37 (an arbitrary odd number) and moves by 2 to the first one coprime with the total. It spreads neighbouring
 * chunks across threads; speed only, never changes a map.
 */
function stride(total: number): number {
  const gcd = (x: number, y: number): number => (y === 0 ? x : gcd(y, x % y));
  let s = 37;
  while (gcd(s, total) !== 1) s += 2;
  return s;
}

/**
 * Chunks for a piece of m blocks: each chunk starts by building its trackers (work about m), so few, large chunks.
 * One chunk per 2500 blocks, never fewer than 64 (enough to keep every thread busy) or more than 1440 (so the setup
 * cost stays small). Speed only, never changes a map: chunk edges are joined, so no result depends on the count.
 */
export const chunksFor = (m: number): number => Math.min(1440, Math.max(64, Math.ceil(m / 2500)));
