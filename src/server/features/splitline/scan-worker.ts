import { parentPort, workerData, type MessagePort } from 'node:worker_threads';
import { DataError } from '../../shared/errors/index.js';
import type { ScanReply, ScanRequest } from './pool.js';
import type { ChunkResult } from './sweep.js';
import { runTask, taskCount } from './tasks.js';

/** One worker of ScanPool: claims tasks (chunks, or tie stretches) from the shared counter until none are left, then reports. */
const { port, health } = workerData as { port: MessagePort; health: Int32Array };
const NEXT = 0, DONE = 1;
const DEAD = 0, CLOSING = 1;
let current: Int32Array | undefined;

// The caller sleeps in Atomics.wait, so it cannot hear this thread's 'exit' event. Leave a flag it can read.
// This covers process.exit and uncaught errors. A silent kill (out of memory) leaves no trace; the caller's stall limit catches that.
process.on('exit', () => {
  if (Atomics.load(health, CLOSING) !== 0) return;
  Atomics.store(health, DEAD, 1);
  if (current) Atomics.notify(current, DONE);
});

parentPort!.on('message', (req: ScanRequest) => {
  current = req.ctrl;
  const total = taskCount(req.job);
  const results: { task: number; result: ChunkResult }[] = [];
  let reply: ScanReply;
  try {
    for (let t = Atomics.add(req.ctrl, NEXT, 1); t < total; t = Atomics.add(req.ctrl, NEXT, 1)) {
      results.push({ task: t, result: runTask(req.piece, req.job, t) });
    }
    reply = { ok: true, id: req.id, results };
  } catch (err) {
    // Stop the other workers early: nothing they find can be used.
    Atomics.store(req.ctrl, NEXT, total);
    reply = { ok: false, id: req.id, message: err instanceof Error ? err.message : String(err), data: err instanceof DataError };
  }
  // Post before counting in: the caller reads the reply as soon as every worker has counted in.
  port.postMessage(reply);
  Atomics.add(req.ctrl, DONE, 1);
  Atomics.notify(req.ctrl, DONE);
});
