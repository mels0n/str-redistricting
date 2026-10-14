import { installPartWorker } from './part-scan-worker-core.js';

/** Test stand-in for a scan worker that exits as soon as it is handed a stolen part. */
installPartWorker(() => process.exit(1));
