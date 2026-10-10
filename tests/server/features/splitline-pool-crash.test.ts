import { afterEach, describe, expect, it } from 'vitest';
import { createContext, findCut, PoolSlot, ScanPool, splitState } from '../../../src/server/features/splitline/index.js';
import { WorkerPoolError } from '../../../src/server/shared/errors/index.js';
import { gridBlocks } from '../../helpers/grid.js';

const dyingUrl = new URL('../../helpers/dying-scan-worker.ts', import.meta.url);
const wrongIdUrl = new URL('../../helpers/wrong-id-scan-worker.ts', import.meta.url);
const all = (n: number) => Int32Array.from({ length: n }, (_, i) => i);
const ctx = createContext(gridBlocks(6, 6));
const search = (pool: ScanPool) => findCut(ctx, all(36), 2, undefined, { pool });
const settle = () => new Promise((r) => setTimeout(r, 300));

const uncaught: unknown[] = [];
const onUncaught = (e: unknown): void => { uncaught.push(e); };
process.on('uncaughtException', onUncaught);
afterEach(() => { uncaught.length = 0; });

describe('pool with a dying worker', () => {
  it('throws promptly, reports broken, and never raises an unhandled error event', async () => {
    const pool = new ScanPool(2, dyingUrl);
    const t0 = Date.now();
    expect(() => search(pool)).toThrow(WorkerPoolError);
    expect(Date.now() - t0).toBeLessThan(15_000); // the stall limit is 15 minutes
    expect(pool.broken).toBe(true);
    await settle(); // let the workers' 'exit' and 'error' events reach their listeners
    expect(uncaught).toEqual([]);

    const t1 = Date.now();
    expect(() => search(pool)).toThrow(/unusable/);
    expect(Date.now() - t1).toBeLessThan(1000);
    await pool.close();
  }, 30_000);

  it('breaks the pool when a worker answers a different request', async () => {
    const pool = new ScanPool(2, wrongIdUrl);
    expect(() => search(pool)).toThrow(WorkerPoolError);
    expect(pool.broken).toBe(true);
    expect(() => search(pool)).toThrow(/unusable/);
    await pool.close();
  }, 30_000);

  it('does not count an exit during close() as a failure', async () => {
    const pool = new ScanPool(2);
    await pool.close();
    await settle();
    expect(pool.broken).toBe(false);
  });

  it('stays usable after a failure the workers reported themselves', async () => {
    const pool = new ScanPool(2);
    const empty = { m: -1, total: 0, ids: new Int32Array(0), pops: new Float64Array(0), px: new Float64Array(0), py: new Float64Array(0), lOff: new Int32Array(0), lAdj: new Int32Array(0), lLen: new Float64Array(0) };
    expect(() => pool.scan(empty, { seats: 2, orientations: [1], chunks: 2, keep: 6 })).toThrow(/length/i);
    expect(pool.broken).toBe(false);
    expect(search(pool)).toEqual(findCut(ctx, all(36), 2));
    await pool.close();
  });
});

describe('PoolSlot', () => {
  it('replaces a broken pool so the next state searches with workers again', async () => {
    const made: ScanPool[] = [];
    const slot = new PoolSlot(2, (n) => { const p = new ScanPool(n, made.length === 0 ? dyingUrl : undefined); made.push(p); return p; });
    expect(() => splitState(ctx, 3, { pool: slot.pool })).toThrow(WorkerPoolError);
    slot.refresh();
    expect(made).toHaveLength(2);
    expect(slot.pool).toBe(made[1]);
    expect(splitState(ctx, 3, { pool: slot.pool })).toEqual(splitState(ctx, 3));
    await settle();
    expect(uncaught).toEqual([]);
    await slot.close();
    await made[0]!.close();
  }, 30_000);

  it('falls back to one thread when a fresh pool cannot be made', async () => {
    let calls = 0;
    const slot = new PoolSlot(2, (n) => { if (calls++ > 0) throw new Error('no threads'); return new ScanPool(n, dyingUrl); });
    const dead = slot.pool!;
    expect(() => search(dead)).toThrow(WorkerPoolError);
    slot.refresh();
    expect(slot.pool).toBeUndefined();
    expect(splitState(ctx, 3, { pool: slot.pool })).toEqual(splitState(ctx, 3));
    await slot.close();
  }, 30_000);

  it('leaves a healthy pool alone', async () => {
    const slot = new PoolSlot(2);
    const before = slot.pool;
    slot.refresh();
    expect(slot.pool).toBe(before);
    await slot.close();
  });

  it('uses no pool for one thread', () => {
    expect(new PoolSlot(1).pool).toBeUndefined();
  });
});
