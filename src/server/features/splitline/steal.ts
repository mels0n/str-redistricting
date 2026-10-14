import type { SplitHook } from './sweep.js';

/**
 * Sharing a chunk sweep between threads while it runs. A cut's chunks are not equally heavy: a dense street grid at
 * one angle can put several times the average work into a few chunks, and once the other threads run out of chunks
 * they would wait for those. So a thread with nothing left to do registers as idle, and a running chunk sweep that
 * sees an idle thread cuts its own remaining directions in half and posts the second half as a part (SplitHook); the
 * idle thread sweeps that part, and may itself be split again. The calling thread joins each chunk's parts back into
 * the result one sweep of the whole chunk gives (joinParts), so how a chunk was split never shows in a map.
 *
 * Shared words after the pool's own (next task, finished workers, heartbeat): threads waiting for a part, threads
 * sweeping, parts posted and not yet taken, a lock over the part list and these counts, a signal word idle threads
 * wait on, a failure flag, and a test switch that splits whenever possible.
 */
export const IDLE = 3, BUSY = 4, PENDING = 5, LOCK = 6, SIGNAL = 7, FAILED = 8, ALWAYS = 9;
export const CTRL_WORDS = 10;
/** Most parts waiting at once; a sweep that finds the list full keeps its directions. */
export const PART_CAP = 1024;
/** Narrowest stretch of directions (degrees) a sweep still splits. */
const MIN_SPLIT_DEG = 1e-4;

/** A posted part: directions [fromDeg, toDeg) of task `task`. */
export interface Part { readonly task: number; readonly fromDeg: number; readonly toDeg: number }

/** The part list: task, from and to of each slot, PART_CAP slots, used as a stack. */
export const newPartList = (): Float64Array => new Float64Array(new SharedArrayBuffer(PART_CAP * 3 * 8));

function lock(ctrl: Int32Array): void {
  while (Atomics.compareExchange(ctrl, LOCK, 0, 1) !== 0) Atomics.wait(ctrl, LOCK, 1, 1);
}
function unlock(ctrl: Int32Array): void {
  Atomics.store(ctrl, LOCK, 0);
  Atomics.notify(ctrl, LOCK, 1);
}
function signal(ctrl: Int32Array): void {
  Atomics.add(ctrl, SIGNAL, 1);
  Atomics.notify(ctrl, SIGNAL);
}

/** One worker's side of the sharing, for one request. */
export class Stealer {
  constructor(private readonly ctrl: Int32Array, private readonly parts: Float64Array) {}

  /** The worker starts sweeping (its first chunk). */
  begin(): void { Atomics.add(this.ctrl, BUSY, 1); }

  /** The hook a sweep of task `task` offers its splits to. */
  hook(task: number): SplitHook {
    const ctrl = this.ctrl, parts = this.parts;
    return {
      propose(lastDeg: number, endDeg: number): number | null {
        if (Atomics.load(ctrl, FAILED) !== 0) return null;
        if (Atomics.load(ctrl, ALWAYS) === 0 && Atomics.load(ctrl, IDLE) <= Atomics.load(ctrl, PENDING)) return null;
        if (!(endDeg - lastDeg > MIN_SPLIT_DEG)) return null;
        return lastDeg + (endDeg - lastDeg) / 2;
      },
      split(atDeg: number, endDeg: number): boolean {
        lock(ctrl);
        const pending = Atomics.load(ctrl, PENDING);
        const wanted = Atomics.load(ctrl, ALWAYS) !== 0 || Atomics.load(ctrl, IDLE) > pending;
        const ok = wanted && pending < PART_CAP && Atomics.load(ctrl, FAILED) === 0;
        if (ok) {
          parts[3 * pending] = task; parts[3 * pending + 1] = atDeg; parts[3 * pending + 2] = endDeg;
          Atomics.store(ctrl, PENDING, pending + 1);
        }
        unlock(ctrl);
        if (ok) signal(ctrl);
        return ok;
      },
    };
  }

  /**
   * The worker finished what it was sweeping and waits for a part: returns the next part to sweep (the worker is then
   * sweeping again), or null when there is none and none can come (no thread is sweeping), or a sweep failed.
   */
  next(): Part | null {
    const ctrl = this.ctrl;
    lock(ctrl);
    Atomics.sub(ctrl, BUSY, 1);
    Atomics.add(ctrl, IDLE, 1);
    unlock(ctrl);
    signal(ctrl);
    for (;;) {
      const seen = Atomics.load(ctrl, SIGNAL);
      lock(ctrl);
      const pending = Atomics.load(ctrl, PENDING);
      if (Atomics.load(ctrl, FAILED) !== 0 || (pending === 0 && Atomics.load(ctrl, BUSY) === 0)) {
        Atomics.sub(ctrl, IDLE, 1);
        unlock(ctrl);
        signal(ctrl);
        return null;
      }
      if (pending > 0) {
        const k = pending - 1;
        const part = { task: this.parts[3 * k]!, fromDeg: this.parts[3 * k + 1]!, toDeg: this.parts[3 * k + 2]! };
        Atomics.store(ctrl, PENDING, k);
        Atomics.sub(ctrl, IDLE, 1);
        Atomics.add(ctrl, BUSY, 1);
        unlock(ctrl);
        return part;
      }
      unlock(ctrl);
      Atomics.wait(ctrl, SIGNAL, seen, 50);
    }
  }

  /** A sweep failed: stop handing out parts, so every worker finishes at once. */
  fail(): void {
    Atomics.store(this.ctrl, FAILED, 1);
    signal(this.ctrl);
  }
}
