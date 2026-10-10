import { parentPort, workerData, type MessagePort } from 'node:worker_threads';
import type { ScanReply, ScanRequest } from '../../src/server/features/splitline/pool.js';
import { runTask, taskCount } from '../../src/server/features/splitline/tasks.js';

/** How long the stand-in holds task 0 of every request: three times the stall limit the tests give the pool. */
export const HOLD_MS = 1500;
const NEXT = 0, DONE = 1, BEAT = 2;

/**
 * Test stand-in for a scan worker whose task 0 runs for HOLD_MS, beating its heartbeat every 100 ms or never.
 * Otherwise it follows the real worker's protocol and returns the real results.
 */
export function slowWorker(beats: boolean): void {
  const { port } = workerData as { port: MessagePort };
  const nap = new Int32Array(new SharedArrayBuffer(4));
  parentPort!.on('message', (req: ScanRequest) => {
    const total = taskCount(req.job);
    const results: { task: number; result: ReturnType<typeof runTask> }[] = [];
    for (let t = Atomics.add(req.ctrl, NEXT, 1); t < total; t = Atomics.add(req.ctrl, NEXT, 1)) {
      if (t === 0) {
        for (let held = 0; held < HOLD_MS; held += 100) {
          Atomics.wait(nap, 0, 0, 100);
          if (beats) Atomics.add(req.ctrl, BEAT, 1);
        }
      }
      results.push({ task: t, result: runTask(req.piece, req.job, t) });
    }
    const reply: ScanReply = { ok: true, id: req.id, results };
    port.postMessage(reply);
    Atomics.add(req.ctrl, DONE, 1);
    Atomics.notify(req.ctrl, DONE);
  });
}
