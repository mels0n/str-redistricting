import { parentPort, threadId, workerData, type MessagePort } from 'node:worker_threads';
import type { ScanReply, ScanRequest } from '../../src/server/features/splitline/pool.js';

/**
 * Test stand-in for a scan worker (in a pool of 4) whose one task fails with its own number. Workers created later
 * (higher thread ids) tend to claim first, so task 0 usually lands on a worker other than the first one the pool
 * reads: the pool must still report task 0, the lowest, not whichever failure it reads first.
 */
const { port } = workerData as { port: MessagePort };
const nap = new Int32Array(new SharedArrayBuffer(4));
parentPort!.on('message', (req: ScanRequest) => {
  Atomics.wait(nap, 0, 0, 80 * (3 - (threadId % 4)));
  const t = Atomics.add(req.ctrl, 0, 1);
  const reply: ScanReply = { ok: false, id: req.id, task: t, message: `task ${t} failed`, data: false };
  port.postMessage(reply);
  Atomics.add(req.ctrl, 1, 1);
  Atomics.notify(req.ctrl, 1);
});
