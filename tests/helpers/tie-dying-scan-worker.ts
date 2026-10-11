import { parentPort } from 'node:worker_threads';
import type { ScanRequest } from '../../src/server/features/splitline/pool.js';

/**
 * Test stand-in for a scan worker that sweeps chunks normally but dies on the first request for tie stretches. The
 * real worker's message handler is wrapped as it is registered, so the exit happens before it touches the request.
 */
const port = parentPort!;
const on = port.on.bind(port);
port.on = ((event: string, handler: (req: ScanRequest) => void) =>
  on(event, event === 'message' ? (req: ScanRequest) => { if (req.job.kind === 'tieSpan') process.exit(1); handler(req); } : handler)) as typeof port.on;
await import('../../src/server/features/splitline/scan-worker.js');
