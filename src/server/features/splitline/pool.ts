import { MessageChannel, receiveMessageOnPort, Worker, type MessagePort } from 'node:worker_threads';
import { DataError, WorkerPoolError } from '../../shared/errors/index.js';
import type { Piece } from './scan.js';
import type { ChunkResult } from './sweep.js';
import { taskCount, type PoolJob } from './tasks.js';

/**
 * Control words shared with the workers: next task to take, how many workers have finished, and a heartbeat the
 * workers bump while a long task runs.
 */
const NEXT = 0, DONE = 1, BEAT = 2;
/** Pool-wide flags the workers can set: one of them died unexpectedly, and the pool is being shut down on purpose. */
const DEAD = 0, CLOSING = 1;
/**
 * Give up when no worker has taken a new task or beaten its heartbeat for this long (a worker killed without a trace
 * never reports and stops beating). A single long task is not a stall: its worker keeps beating.
 */
const STALL_MS = 15 * 60_000;

export interface ScanPoolOptions {
  /** Swaps the worker script (tests only). */
  readonly workerUrl?: URL;
  /** Overrides the stall limit (tests only). */
  readonly stallMs?: number;
}

export interface ScanRequest {
  /** Identifies the request, so a reply that belongs to an earlier one is never taken for this one's. */
  readonly id: number;
  readonly piece: Piece;
  readonly job: PoolJob;
  readonly ctrl: Int32Array;
}

export type ScanReply =
  | { readonly ok: true; readonly id: number; readonly results: readonly { readonly task: number; readonly result: ChunkResult }[] }
  | { readonly ok: false; readonly id: number; readonly task: number; readonly message: string; readonly data: boolean };

function shared<T extends Float64Array | Int32Array>(src: T): T {
  const Ctor = src.constructor as { new (b: SharedArrayBuffer): T; BYTES_PER_ELEMENT: number };
  const out = new Ctor(new SharedArrayBuffer(src.length * Ctor.BYTES_PER_ELEMENT));
  out.set(src);
  return out;
}

/**
 * Worker threads that run a cut's sweep tasks in parallel (chunks of directions, or tie stretches). Each worker
 * takes the next unclaimed task and reports each task's result under that task's number, so the results do not
 * depend on which worker ran what or when. The calling thread blocks until every worker has finished, which keeps
 * the cut search synchronous. When tasks fail, the failure of the lowest-numbered task is reported, the one the
 * calling thread alone would have met first.
 *
 * A pool that lost a worker, or gave up waiting for one, is broken for good: its workers are terminated and
 * every later scan throws at once. Callers replace it. Reusing it could mix a late worker's output into a new request.
 */
export class ScanPool {
  readonly size: number;
  private readonly workers: { readonly worker: Worker; readonly port: MessagePort }[] = [];
  private readonly health = new Int32Array(new SharedArrayBuffer(8));
  private nextId = 0;
  private reason: string | undefined;
  private readonly stallMs: number;

  constructor(size: number, opts: ScanPoolOptions = {}) {
    if (!Number.isInteger(size) || size < 1) throw new RangeError(`pool size must be a positive integer, got ${size}`);
    this.size = size;
    this.stallMs = opts.stallMs ?? STALL_MS;
    const ts = import.meta.url.endsWith('.ts');
    // Keep the worker named by a './…' string literal: explore's code fingerprint (run-stamp) finds the worker that way.
    const url = opts.workerUrl ?? new URL(ts ? './scan-worker.ts' : './scan-worker.js', import.meta.url);
    for (let i = 0; i < size; i++) {
      const { port1, port2 } = new MessageChannel();
      const worker = new Worker(url, { workerData: { port: port2, health: this.health }, transferList: [port2], execArgv: ts ? ['--import', 'tsx'] : [] });
      worker.unref();
      // Listeners keep an early death from surfacing as an unhandled 'error' event. They only run once the caller is back on the event loop.
      worker.on('error', (err: Error) => this.retire(`a cut search worker failed: ${err.message}`));
      worker.on('exit', (code) => { if (Atomics.load(this.health, CLOSING) === 0) this.retire(`a cut search worker exited (code ${code})`); });
      this.workers.push({ worker, port: port1 });
    }
  }

  get broken(): boolean {
    return this.reason !== undefined;
  }

  /** Sweep every task of `job` (chunks, or tie stretches) on `piece`; returns the results in task order. */
  scan(piece: Piece, job: PoolJob): ChunkResult[] {
    if (this.reason !== undefined) throw new WorkerPoolError(`cut search pool is unusable: ${this.reason}`);
    try {
      return this.run(piece, job);
    } catch (err) {
      // A failure the workers reported themselves leaves every worker idle and every reply read: the pool stays usable.
      if (!(err instanceof ReportedFailure)) this.retire(err instanceof Error ? err.message : String(err));
      throw err instanceof ReportedFailure ? err.cause : err;
    }
  }

  private run(piece: Piece, job: PoolJob): ChunkResult[] {
    // Fresh control words per request: a worker that is somehow still on an older request cannot touch this one's.
    const ctrl = new Int32Array(new SharedArrayBuffer(12));
    const req: ScanRequest = {
      id: this.nextId++,
      piece: {
        m: piece.m, total: piece.total, ids: shared(piece.ids), pops: shared(piece.pops), px: shared(piece.px), py: shared(piece.py),
        lOff: shared(piece.lOff), lAdj: shared(piece.lAdj), lLen: shared(piece.lLen),
      },
      job,
      ctrl,
    };
    for (const w of this.workers) w.worker.postMessage(req);
    let lastNext = 0, lastBeat = 0, lastProgress = Date.now();
    for (;;) {
      const done = Atomics.load(ctrl, DONE);
      if (done === this.size) break;
      // This thread is blocked, so a worker's 'exit' event cannot run. Instead a dying worker sets the DEAD flag
      // (and wakes this wait), and the flag is checked on every pass, at worst one wait slice (1 s, less only under
      // a test's short stall limit) later.
      if (Atomics.load(this.health, DEAD) !== 0) throw new WorkerPoolError('a cut search worker died');
      Atomics.wait(ctrl, DONE, done, Math.min(1000, this.stallMs / 4));
      // Progress is a new task taken or a heartbeat from a task still running.
      const next = Atomics.load(ctrl, NEXT), beat = Atomics.load(ctrl, BEAT);
      if (next !== lastNext || beat !== lastBeat) { lastNext = next; lastBeat = beat; lastProgress = Date.now(); }
      else if (Date.now() - lastProgress > this.stallMs) throw new WorkerPoolError('cut search workers stopped making progress');
    }
    let failure: Extract<ScanReply, { ok: false }> | undefined;
    const results: ChunkResult[] = [];
    const nap = new Int32Array(new SharedArrayBuffer(4));
    for (const w of this.workers) {
      let got = receiveMessageOnPort(w.port);
      for (let tries = 0; !got && tries < 500; tries++) { Atomics.wait(nap, 0, 0, 10); got = receiveMessageOnPort(w.port); }
      if (!got) throw new WorkerPoolError('a cut search worker finished without reporting');
      const msg = got.message as ScanReply;
      if (msg.id !== req.id) throw new WorkerPoolError('a cut search worker answered a different request');
      // Every task below a failed one was claimed before it and ran to its end, so the lowest failed task is the one
      // a single thread would have stopped at.
      if (!msg.ok) { if (!failure || msg.task < failure.task) failure = msg; }
      else for (const r of msg.results) results[r.task] = r.result;
    }
    if (failure) throw new ReportedFailure(failure.data ? new DataError(failure.message) : new Error(failure.message));
    // Every task is claimed exactly once; a missing one is a pool fault, reported as such rather than as a crash later.
    const total = taskCount(job);
    for (let t = 0; t < total; t++) if (!results[t]) throw new WorkerPoolError('a cut search worker lost a task');
    if (results.length !== total) throw new WorkerPoolError('a cut search worker reported a task that does not exist');
    return results;
  }

  /** Mark the pool unusable and stop its workers. Safe to repeat; the first reason wins. */
  private retire(reason: string): void {
    this.reason ??= reason;
    this.stop().catch(() => undefined);
  }

  private stop(): Promise<unknown[]> {
    Atomics.store(this.health, CLOSING, 1);
    return Promise.all(this.workers.map((w) => { w.port.close(); return w.worker.terminate(); }));
  }

  async close(): Promise<void> {
    await this.stop();
  }
}

/** A failure a worker reported after finishing cleanly (not a lost worker). */
class ReportedFailure {
  constructor(readonly cause: Error) {}
}
