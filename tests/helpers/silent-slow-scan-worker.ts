import { slowWorker } from './slow-scan-worker.js';

/** Holds task 0 well past the stall limit without beating: to the pool it looks stalled. */
slowWorker(false);
