import { parentPort, workerData } from 'node:worker_threads';
import { Stealer, type Part } from '../../src/server/features/splitline/steal.js';

/** Test stand-in: starts sweeping, then waits in next() and reports what it got and how long it waited. */
const { ctrl, parts } = workerData as { ctrl: Int32Array; parts: Float64Array };
const stealer = new Stealer(ctrl, parts);
stealer.begin();
const t0 = Date.now();
const part: Part | null = stealer.next();
parentPort!.postMessage({ part, waitedMs: Date.now() - t0 });
