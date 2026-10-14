import { Worker } from 'node:worker_threads';
import { describe, expect, it, vi } from 'vitest';
import { ALWAYS, BUSY, CTRL_WORDS, FAILED, IDLE, newPartList, PART_CAP, PENDING, Stealer, type Part } from '../../../src/server/features/splitline/steal.js';

const fresh = () => ({ ctrl: new Int32Array(new SharedArrayBuffer(4 * CTRL_WORDS)), parts: newPartList() });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waiterUrl = new URL('../../helpers/stealer-waiter-worker.ts', import.meta.url);

interface Answer { part: Part | null; waitedMs: number }

/** Starts the waiter thread and resolves once it is blocked in next() (it counts itself idle). */
async function startWaiter(ctrl: Int32Array, parts: Float64Array): Promise<{ worker: Worker; answer: Promise<Answer> }> {
  const worker = new Worker(waiterUrl, { workerData: { ctrl, parts }, execArgv: ['--import', 'tsx'] });
  const answer = new Promise<Answer>((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
  for (let i = 0; Atomics.load(ctrl, IDLE) !== 1; i++) {
    if (i > 1000) throw new Error('the waiter never reached next()');
    await sleep(10);
  }
  return { worker, answer };
}

describe('Stealer', () => {
  it('posts parts up to the cap, refuses the next, and hands them out last posted first', () => {
    const { ctrl, parts } = fresh();
    ctrl[ALWAYS] = 1;
    const hook = new Stealer(ctrl, parts).hook(7);
    for (let i = 0; i < PART_CAP; i++) expect(hook.split(10 + i, 500 + i), `part ${i}`).toBe(true);
    expect(hook.split(1, 2)).toBe(false);
    expect(Atomics.load(ctrl, PENDING)).toBe(PART_CAP);
    const taker = new Stealer(ctrl, parts);
    taker.begin();
    for (let i = PART_CAP - 1; i >= 0; i--) {
      expect(taker.next()).toEqual({ task: 7, fromDeg: 10 + i, toDeg: 500 + i });
    }
    expect(Atomics.load(ctrl, PENDING)).toBe(0);
  });

  it('proposes nothing once a sweep has failed, and refuses to split', () => {
    const { ctrl, parts } = fresh();
    ctrl[ALWAYS] = 1;
    const stealer = new Stealer(ctrl, parts);
    const hook = stealer.hook(0);
    expect(hook.propose(0, 10)).toBe(5);
    stealer.fail();
    expect(Atomics.load(ctrl, FAILED)).toBe(1);
    expect(hook.propose(0, 10)).toBeNull();
    expect(hook.split(5, 10)).toBe(false);
    expect(Atomics.load(ctrl, PENDING)).toBe(0);
  });

  it('answers null at once when nothing is pending and no thread is sweeping', () => {
    const { ctrl, parts } = fresh();
    const stealer = new Stealer(ctrl, parts);
    stealer.begin();
    // Waiting is an Atomics.wait on SIGNAL (up to 50 ms a round), so "at once" means that call was never made.
    const wait = vi.spyOn(Atomics, 'wait');
    try {
      expect(stealer.next()).toBeNull();
      expect(wait).not.toHaveBeenCalled();
    } finally {
      wait.mockRestore();
    }
    expect(Atomics.load(ctrl, BUSY)).toBe(0);
    expect(Atomics.load(ctrl, IDLE)).toBe(0);
  });

  it('releases a waiter when a sweep fails', async () => {
    const { ctrl, parts } = fresh();
    const main = new Stealer(ctrl, parts);
    main.begin(); // the calling thread still counts as sweeping, so the waiter has to wait
    const { worker, answer } = await startWaiter(ctrl, parts);
    try {
      let answered = false;
      void answer.then(() => { answered = true; });
      await sleep(200);
      expect(answered).toBe(false);
      main.fail();
      const got = await Promise.race([answer, sleep(5000).then(() => 'timeout' as const)]);
      expect(got).not.toBe('timeout');
      expect((got as Answer).part).toBeNull();
      expect(Atomics.load(ctrl, IDLE)).toBe(0);
    } finally {
      await worker.terminate();
    }
  }, 20_000);

  it('hands a waiter the part another thread posts', async () => {
    const { ctrl, parts } = fresh();
    ctrl[ALWAYS] = 1;
    const main = new Stealer(ctrl, parts);
    main.begin();
    const { worker, answer } = await startWaiter(ctrl, parts);
    try {
      let answered = false;
      void answer.then(() => { answered = true; });
      await sleep(200);
      expect(answered).toBe(false);
      expect(main.hook(3).split(20, 40)).toBe(true);
      const got = await Promise.race([answer, sleep(5000).then(() => 'timeout' as const)]);
      expect(got).not.toBe('timeout');
      expect((got as Answer).part).toEqual({ task: 3, fromDeg: 20, toDeg: 40 });
      expect(Atomics.load(ctrl, PENDING)).toBe(0);
      expect(Atomics.load(ctrl, BUSY)).toBe(2);
    } finally {
      await worker.terminate();
    }
  }, 20_000);
});
