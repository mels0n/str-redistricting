import { describe, expect, it } from 'vitest';
import { buildTopology } from '../../../src/server/entities/census-block/index.js';
import { assignmentCsv, computeMetrics } from '../../../src/server/features/metrics/index.js';
import { gridBlocks } from '../../helpers/grid.js';

describe('computeMetrics', () => {
  const blocks = [
    ...gridBlocks(2, 1, { geoidPrefix: '08001' }),
    ...gridBlocks(2, 1, { geoidPrefix: '08003', origin: [0.02, 0], indexOffset: 2 }),
  ];
  const topo = buildTopology(blocks);

  it('reports population range against the ideal', () => {
    const m = computeMetrics(blocks, topo, Int32Array.from([0, 0, 0, 1]), 2);
    expect(m.ideal).toBe(2);
    expect(m.rangePersons).toBe(2);
    expect(m.rangePct).toBeCloseTo(100);
    expect(m.allContiguous).toBe(true);
  });
  it('counts counties split between districts', () => {
    expect(computeMetrics(blocks, topo, Int32Array.from([0, 0, 1, 1]), 2).countiesSplit).toBe(0);
    expect(computeMetrics(blocks, topo, Int32Array.from([0, 0, 0, 1]), 2).countiesSplit).toBe(1);
  });
  it('hashes the assignment so runs can be compared', () => {
    const a = computeMetrics(blocks, topo, Int32Array.from([0, 0, 1, 1]), 2).assignmentSha256;
    const b = computeMetrics(blocks, topo, Int32Array.from([0, 0, 1, 1]), 2).assignmentSha256;
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it('writes a 1-based CSV', () => {
    expect(assignmentCsv(blocks.slice(0, 2), Int32Array.from([0, 1]))).toBe(
      `GEOID20,district\n${blocks[0]!.geoid},1\n${blocks[1]!.geoid},2\n`,
    );
  });
});
