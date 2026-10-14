import { describe, expect, it } from 'vitest';
import { createContext, findCut, ScanPool } from '../../../src/server/features/splitline/index.js';
import { gridBlocks } from '../../helpers/grid.js';

const all = (n: number) => Int32Array.from({ length: n }, (_, i) => i);
const ctx = createContext(gridBlocks(12, 12));

describe('split and re-swept chunk counts', () => {
  it('are 0 on the calling thread', () => {
    const r = findCut(ctx, all(144), 2);
    expect(r.scan.splitChunks).toBe(0);
    expect(r.scan.resweptChunks).toBe(0);
  });

  it('count the chunks a pool split during this search only', async () => {
    const pool = new ScanPool(4, { splitAlways: true });
    try {
      const first = findCut(ctx, all(144), 2, undefined, { pool });
      expect(first.scan.splitChunks).toBeGreaterThan(0);
      expect(first.scan.resweptChunks).toBeGreaterThanOrEqual(0);
      expect(first.scan.resweptChunks).toBeLessThanOrEqual(first.scan.splitChunks);
      const before = { ...pool.splits };
      const second = findCut(ctx, all(144), 2, undefined, { pool });
      expect(second.scan.splitChunks).toBe(pool.splits.chunks - before.chunks);
      expect(second.scan.resweptChunks).toBe(pool.splits.reswept - before.reswept);
    } finally {
      await pool.close();
    }
  }, 30_000);
});
