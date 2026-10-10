import { parentPort, workerData, type MessagePort } from 'node:worker_threads';
import type { ScanRequest } from '../../src/server/features/splitline/pool.js';

/** Test stand-in for a scan worker that counts in but answers with the id of a different request. */
const { port } = workerData as { port: MessagePort };
parentPort!.on('message', (req: ScanRequest) => {
  port.postMessage({ ok: true, id: req.id + 1000, results: [] });
  Atomics.add(req.ctrl, 1, 1);
  Atomics.notify(req.ctrl, 1);
});
