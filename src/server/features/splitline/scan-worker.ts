import { parentPort, workerData, type MessagePort } from 'node:worker_threads';
import { DataError } from '../../shared/errors/index.js';
import type { ScanReply, ScanRequest } from './pool.js';
import { scanDirections } from './scan.js';

/** One worker of ScanPool: claims directions from the shared counter until none are left, then reports. */
const port = (workerData as { port: MessagePort }).port;
const NEXT = 0, DONE = 1;

parentPort!.on('message', (req: ScanRequest) => {
  let reply: ScanReply = { ok: true };
  try {
    scanDirections(req.piece, req.job, req.res, () => Atomics.add(req.ctrl, NEXT, 1));
  } catch (err) {
    // Stop the other workers early: nothing they find can be used.
    Atomics.store(req.ctrl, NEXT, req.job.angleCount);
    reply = { ok: false, message: err instanceof Error ? err.message : String(err), data: err instanceof DataError };
  }
  // Post before counting in: the caller reads the reply as soon as every worker has counted in.
  port.postMessage(reply);
  Atomics.add(req.ctrl, DONE, 1);
  Atomics.notify(req.ctrl, DONE);
});
