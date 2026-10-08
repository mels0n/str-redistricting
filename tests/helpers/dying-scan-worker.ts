import { parentPort } from 'node:worker_threads';
import '../../src/server/features/splitline/scan-worker.js';

/** Test stand-in for a scan worker that dies outside its try/catch: exits as soon as it gets a request. */
(parentPort as unknown as NodeJS.EventEmitter).prependListener('message', () => process.exit(1));
