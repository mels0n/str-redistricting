import { MessageChannel, receiveMessageOnPort, Worker, type MessagePort } from 'node:worker_threads';
import { DataError, WorkerPoolError } from '../../shared/errors/index.js';
import { FIELDS, type Piece, type ScanJob } from './scan.js';

/** Control words shared with the workers: next direction to take, and how many workers have finished. */
const NEXT = 0, DONE = 1;
/** Pool-wide flags the workers can set: one of them died unexpectedly, and the pool is being shut down on purpose. */
const DEAD = 0, CLOSING = 1;
/** Give up when no worker has taken a new direction for this long (a worker killed without a trace never reports). */
const STALL_MS = 15 * 60_000;

export interface ScanRequest {
  /** Identifies the request, so a reply that belongs to an earlier one is never taken for this one's. */
  readonly id: number;
  readonly piece: Piece;
  readonly job: ScanJob;
  readonly res: Float64Array;
  readonly ctrl: Int32Array;
}

export type ScanReply =
  | { readonly ok: true; readonly id: number }
  | { readonly ok: false; readonly id: number; readonly message: string; readonly data: boolean };

function shared<T extends Float64Array | Int32Array>(src: T): T {
  const Ctor = src.constructor as { new (b: SharedArrayBuffer): T; BYTES_PER_ELEMENT: number };
  const out = new Ctor(new SharedArrayBuffer(src.length * Ctor.BYTES_PER_ELEMENT));
  out.set(src);
  return out;
}

/**
 * Worker threads that evaluate a cut's candidate directions in parallel. Each worker takes the next
 * unclaimed direction and writes that direction's results into its own slots of a shared buffer, so the
 * buffer's contents do not depend on which worker evaluated what or when. The calling thread blocks
 * until every worker has finished, which keeps the cut search synchronous.
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

  /** `workerUrl` swaps the worker script (tests only). */
  constructor(size: number, workerUrl?: URL) {
    if (!Number.isInteger(size) || size < 1) throw new RangeError(`pool size must be a positive integer, got ${size}`);
    this.size = size;
    const ts = import.meta.url.endsWith('.ts');
    const url = workerUrl ?? new URL(ts ? './scan-worker.ts' : './scan-worker.js', import.meta.url);
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

  /** Evaluate every candidate of `job` on `piece`; returns FIELDS numbers per candidate, laid out as scanDirections does. */
  scan(piece: Piece, job: ScanJob): Float64Array {
    if (this.reason !== undefined) throw new WorkerPoolError(`cut search pool is unusable: ${this.reason}`);
    try {
      return this.run(piece, job);
    } catch (err) {
      // A failure the workers reported themselves leaves every worker idle and every reply read: the pool stays usable.
      if (!(err instanceof ReportedFailure)) this.retire(err instanceof Error ? err.message : String(err));
      throw err instanceof ReportedFailure ? err.cause : err;
    }
  }

  private run(piece: Piece, job: ScanJob): Float64Array {
    // Fresh control words per request: a worker that is somehow still on an older request cannot touch this one's.
    const ctrl = new Int32Array(new SharedArrayBuffer(8));
    const req: ScanRequest = {
      id: this.nextId++,
      piece: {
        m: piece.m, total: piece.total, ids: shared(piece.ids), pops: shared(piece.pops), px: shared(piece.px), py: shared(piece.py),
        lOff: shared(piece.lOff), lAdj: shared(piece.lAdj), lLen: shared(piece.lLen),
      },
      job,
      res: new Float64Array(new SharedArrayBuffer(job.angleCount * job.orientations.length * FIELDS * 8)),
      ctrl,
    };
    for (const w of this.workers) w.worker.postMessage(req);
    let lastNext = 0, lastProgress = Date.now();
    for (;;) {
      const done = Atomics.load(ctrl, DONE);
      if (done === this.size) break;
      // This thread is blocked, so a worker's 'exit' event cannot run. Instead a dying worker sets the DEAD flag
      // (and wakes this wait), and the flag is checked on every pass, at worst one wait slice (1 s) later.
      if (Atomics.load(this.health, DEAD) !== 0) throw new WorkerPoolError('a cut search worker died');
      Atomics.wait(ctrl, DONE, done, 1000);
      const next = Atomics.load(ctrl, NEXT);
      if (next !== lastNext) { lastNext = next; lastProgress = Date.now(); }
      else if (Date.now() - lastProgress > STALL_MS) throw new WorkerPoolError('cut search workers stopped making progress');
    }
    let failure: Extract<ScanReply, { ok: false }> | undefined;
    const nap = new Int32Array(new SharedArrayBuffer(4));
    for (const w of this.workers) {
      let got = receiveMessageOnPort(w.port);
      for (let tries = 0; !got && tries < 500; tries++) { Atomics.wait(nap, 0, 0, 10); got = receiveMessageOnPort(w.port); }
      if (!got) throw new WorkerPoolError('a cut search worker finished without reporting');
      const msg = got.message as ScanReply;
      if (msg.id !== req.id) throw new WorkerPoolError('a cut search worker answered a different request');
      if (!msg.ok) failure ??= msg;
    }
    if (failure) throw new ReportedFailure(failure.data ? new DataError(failure.message) : new Error(failure.message));
    return req.res;
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
