import { MessageChannel, receiveMessageOnPort, Worker, type MessagePort } from 'node:worker_threads';
import { DataError } from '../../shared/errors/index.js';
import { FIELDS, type Piece, type ScanJob } from './scan.js';

/** Control words shared with the workers: next direction to take, and how many workers have finished. */
const NEXT = 0, DONE = 1;
/** Give up when no worker has taken a new direction for this long (a worker that died never reports). */
const STALL_MS = 15 * 60_000;

export interface ScanRequest {
  readonly piece: Piece;
  readonly job: ScanJob;
  readonly res: Float64Array;
  readonly ctrl: Int32Array;
}

export type ScanReply = { readonly ok: true } | { readonly ok: false; readonly message: string; readonly data: boolean };

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
 */
export class ScanPool {
  readonly size: number;
  private readonly workers: { readonly worker: Worker; readonly port: MessagePort }[] = [];
  private readonly ctrl = new Int32Array(new SharedArrayBuffer(8));

  constructor(size: number) {
    if (!Number.isInteger(size) || size < 1) throw new RangeError(`pool size must be a positive integer, got ${size}`);
    this.size = size;
    const ts = import.meta.url.endsWith('.ts');
    const url = new URL(ts ? './scan-worker.ts' : './scan-worker.js', import.meta.url);
    for (let i = 0; i < size; i++) {
      const { port1, port2 } = new MessageChannel();
      const worker = new Worker(url, { workerData: { port: port2 }, transferList: [port2], execArgv: ts ? ['--import', 'tsx'] : [] });
      worker.unref();
      this.workers.push({ worker, port: port1 });
    }
  }

  /** Evaluate every candidate of `job` on `piece`; returns FIELDS numbers per candidate, laid out as scanDirections does. */
  scan(piece: Piece, job: ScanJob): Float64Array {
    const req: ScanRequest = {
      piece: {
        m: piece.m, total: piece.total, ids: shared(piece.ids), pops: shared(piece.pops), px: shared(piece.px), py: shared(piece.py),
        lOff: shared(piece.lOff), lAdj: shared(piece.lAdj), lLen: shared(piece.lLen),
      },
      job,
      res: new Float64Array(new SharedArrayBuffer(job.angleCount * job.orientations.length * FIELDS * 8)),
      ctrl: this.ctrl,
    };
    Atomics.store(this.ctrl, NEXT, 0);
    Atomics.store(this.ctrl, DONE, 0);
    for (const w of this.workers) w.worker.postMessage(req);
    let lastNext = 0, lastProgress = Date.now();
    for (;;) {
      const done = Atomics.load(this.ctrl, DONE);
      if (done === this.size) break;
      Atomics.wait(this.ctrl, DONE, done, 1000);
      const next = Atomics.load(this.ctrl, NEXT);
      if (next !== lastNext) { lastNext = next; lastProgress = Date.now(); }
      else if (Date.now() - lastProgress > STALL_MS) throw new Error('cut search workers stopped making progress');
    }
    let failure: Extract<ScanReply, { ok: false }> | undefined;
    const nap = new Int32Array(new SharedArrayBuffer(4));
    for (const w of this.workers) {
      let got = receiveMessageOnPort(w.port);
      for (let tries = 0; !got && tries < 500; tries++) { Atomics.wait(nap, 0, 0, 10); got = receiveMessageOnPort(w.port); }
      if (!got) throw new Error('a cut search worker finished without reporting');
      const msg = got.message as ScanReply;
      if (!msg.ok) failure ??= msg;
    }
    if (failure) throw failure.data ? new DataError(failure.message) : new Error(failure.message);
    return req.res;
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => { w.port.close(); return w.worker.terminate(); }));
  }
}
