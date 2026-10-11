import { slowWorker } from './slow-scan-worker.js';

/** Holds task 0 well past the stall limit, beating its heartbeat all the while. */
slowWorker(true);
