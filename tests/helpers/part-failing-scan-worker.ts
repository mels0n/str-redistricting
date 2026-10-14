import { installPartWorker } from './part-scan-worker-core.js';

/** Test stand-in for a scan worker whose sweep of a stolen part throws, while other workers may wait for parts. */
installPartWorker(() => { throw new Error('part failed'); });
