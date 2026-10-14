import { afterEach, describe, expect, it } from 'vitest';
import { createContext, findCut, ScanPool } from '../../../src/server/features/splitline/index.js';
import { WorkerPoolError } from '../../../src/server/shared/errors/index.js';
import { withoutCounters } from '../../helpers/counters.js';
import { gridBlocks } from '../../helpers/grid.js';

const partFailingUrl = new URL('../../helpers/part-failing-scan-worker.ts', import.meta.url);
const partDyingUrl = new URL('../../helpers/part-dying-scan-worker.ts', import.meta.url);
const all = (n: number) => Int32Array.from({ length: n }, (_, i) => i);
const ctx = createContext(gridBlocks(12, 12));
const search = (pool?: ScanPool) => findCut(ctx, all(144), 2, undefined, pool ? { pool } : undefined);
const settle = () => new Promise((r) => setTimeout(r, 300));

const uncaught: unknown[] = [];
process.on('uncaughtException', (e: unknown) => { uncaught.push(e); });
afterEach(() => { uncaught.length = 0; });

describe('a worker lost while sweeping a stolen part', () => {
  it('reports the failure promptly instead of hanging, and leaves the pool usable', async () => {
    const pool = new ScanPool(4, { workerUrl: partFailingUrl, splitAlways: true });
    const t0 = Date.now();
    expect(() => search(pool)).toThrow(/part failed/);
    expect(Date.now() - t0).toBeLessThan(15_000); // the stall limit is 15 minutes
    expect(pool.broken).toBe(false);
    await pool.close();
    const fresh = new ScanPool(2);
    expect(withoutCounters(search(fresh))).toEqual(withoutCounters(search()));
    await fresh.close();
  }, 30_000);

  it('fails as a pool error when the worker exits, and raises no unhandled error event', async () => {
    const pool = new ScanPool(4, { workerUrl: partDyingUrl, splitAlways: true });
    const t0 = Date.now();
    expect(() => search(pool)).toThrow(WorkerPoolError);
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(pool.broken).toBe(true);
    await settle();
    expect(uncaught).toEqual([]);
    await pool.close();
  }, 30_000);
});
