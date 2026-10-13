import { parentPort, workerData, type MessagePort } from 'node:worker_threads';
import { DataError } from '../../src/server/shared/errors/index.js';
import type { ScanReply, ScanRequest } from '../../src/server/features/splitline/pool.js';
import type { ChunkResult } from '../../src/server/features/splitline/sweep.js';
import { Stealer } from '../../src/server/features/splitline/steal.js';
import { runPart, runTask, taskCount } from '../../src/server/features/splitline/tasks.js';

/**
 * The scan worker's protocol, copied from the real worker, with one difference: `onPart` runs in place of sweeping a
 * stolen part (so a stand-in can throw or exit exactly when it is handed one). If `onPart` returns, the part is swept
 * as usual.
 */
export function installPartWorker(onPart: () => void): void {
  const { port, health } = workerData as { port: MessagePort; health: Int32Array };
  const NEXT = 0, DONE = 1, BEAT = 2;
  const DEAD = 0, CLOSING = 1;
  let current: Int32Array | undefined;
  process.on('exit', () => {
    if (Atomics.load(health, CLOSING) !== 0) return;
    Atomics.store(health, DEAD, 1);
    if (current) Atomics.notify(current, DONE);
  });
  parentPort!.on('message', (req: ScanRequest) => {
    current = req.ctrl;
    const total = taskCount(req.job);
    const results: { task: number; result: readonly ChunkResult[] }[] = [];
    const beat = () => { Atomics.add(req.ctrl, BEAT, 1); };
    let reply: ScanReply;
    let t = -1;
    const job = req.job;
    const stealer = job.kind === 'tieSpan' ? undefined : new Stealer(req.ctrl, req.parts);
    try {
      stealer?.begin();
      for (t = Atomics.add(req.ctrl, NEXT, 1); t < total; t = Atomics.add(req.ctrl, NEXT, 1)) {
        results.push({ task: t, result: runTask(req.piece, job, t, beat, stealer?.hook(t)) });
      }
      if (stealer && job.kind !== 'tieSpan') {
        for (let part = stealer.next(); part; part = stealer.next()) {
          t = part.task;
          onPart();
          results.push({ task: t, result: [runPart(req.piece, job, t, part.fromDeg, part.toDeg, beat, stealer.hook(t))] });
        }
      }
      reply = { ok: true, id: req.id, results };
    } catch (err) {
      Atomics.store(req.ctrl, NEXT, total);
      stealer?.fail();
      reply = { ok: false, id: req.id, task: t, message: err instanceof Error ? err.message : String(err), data: err instanceof DataError };
    }
    port.postMessage(reply);
    Atomics.add(req.ctrl, DONE, 1);
    Atomics.notify(req.ctrl, DONE);
  });
}
