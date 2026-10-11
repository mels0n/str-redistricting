import { describe, expect, it } from 'vitest';
import { cutStats } from '../../../src/server/app/cut-stats.js';
import { createContext, splitState } from '../../../src/server/features/splitline/index.js';
import { gridBlocks } from '../../helpers/grid.js';

describe('cut-stats.json records', () => {
  it('carry the search counters of every cut as numbers', () => {
    const ctx = createContext(gridBlocks(6, 5, { pop: (x, y) => (x + y) % 3 }));
    const { cuts } = splitState(ctx, 4);
    expect(cuts.length).toBeGreaterThan(0);
    cuts.forEach((c, i) => {
      const rec = cutStats(c, i);
      expect(rec.order).toBe(i + 1);
      for (const k of ['tieSpanMs', 'derivedBuilds', 'reconfigs', 'exactFallbacks'] as const) {
        expect(typeof rec[k], k).toBe('number');
        expect(Number.isInteger(rec[k]), k).toBe(true);
        expect(rec[k], k).toBeGreaterThanOrEqual(0);
      }
      expect(rec.derivedBuilds).toBe(c.scan.derivedBuilds);
    });
  });
});
