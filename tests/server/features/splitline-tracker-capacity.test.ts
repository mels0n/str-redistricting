import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';

const workerUrl = new URL('../../helpers/tracker-capacity-worker.ts', import.meta.url);

interface Heaps { readonly nA: number; readonly nB: number; readonly hA: number[]; readonly hB: number[] }

/** Runs the worker and gives up on it after `ms`: a tracker that corrupts its heaps can loop forever. */
function run(ms: number): Promise<Heaps | 'timeout'> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl, { execArgv: ['--import', 'tsx'] });
    const timer = setTimeout(() => { void worker.terminate(); resolve('timeout'); }, ms);
    worker.once('message', (h: Heaps) => { clearTimeout(timer); void worker.terminate(); resolve(h); });
    worker.once('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

describe('tracker reuse', () => {
  // A chain keeps the trackers of passes it dropped and reconfigures one for a later pass with more free blocks.
  // The heaps are sized to the free blocks the tracker was built with, so a tracker reconfigured to more blocks than
  // that writes past the end of its Int32Arrays, which JavaScript silently ignores: the heaps end up holding
  // duplicates and the tracker's events never run out.
  it('holds every free block exactly once after it is reconfigured to more free blocks than it was built with', async () => {
    const out = await run(10_000);
    expect(out, 'the tracker did not return from reconfigure').not.toBe('timeout');
    const heaps = out as Heaps;
    expect(heaps.nA + heaps.nB).toBe(6);
    expect(new Set([...heaps.hA, ...heaps.hB]).size).toBe(6);
  }, 20_000);
});
