import { describe, expect, it } from 'vitest';
import { boundarySegments, buildTopology, isConnected, type Block } from '../../../src/server/entities/census-block/index.js';
import { greatCircleDistance } from '../../../src/server/shared/geo/index.js';
import { gridBlocks } from '../../helpers/grid.js';

const neighbors = (t: ReturnType<typeof buildTopology>, i: number) =>
  Array.from(t.adjList.subarray(t.adjOffsets[i]!, t.adjOffsets[i + 1]!)).sort((a, b) => a - b);

describe('buildTopology', () => {
  const blocks = gridBlocks(2, 2); // indices: 0=(0,0) 1=(1,0) 2=(0,1) 3=(1,1)
  const topo = buildTopology(blocks);

  it('connects blocks that share an edge, not a corner', () => {
    expect(neighbors(topo, 0)).toEqual([1, 2]);
    expect(neighbors(topo, 3)).toEqual([1, 2]);
  });
  it('finds the outer boundary of the whole grid', () => {
    expect(boundarySegments(topo, Int32Array.from([0, 1, 2, 3]))).toHaveLength(8);
  });
  it('treats corner-only contact as disconnected', () => {
    expect(isConnected(topo, Int32Array.from([0, 3]))).toBe(false);
    expect(isConnected(topo, Int32Array.from([0, 1, 3]))).toBe(true);
  });
});

describe('island bridging (water counts as connection)', () => {
  const main = gridBlocks(3, 1);
  const island = gridBlocks(1, 1, { origin: [0.05, 0], indexOffset: 100 });
  const topo = buildTopology([...main, ...island]);
  it('adds one bridge from the island to the nearest main block', () => {
    expect(topo.bridges).toEqual([[2, 3]]);
    expect(isConnected(topo, Int32Array.from([0, 1, 2, 3]))).toBe(true);
  });
});

describe('multiple islands at different distances', () => {
  const main = gridBlocks(3, 1);
  const island1 = gridBlocks(1, 1, { origin: [0.1, 0] });
  const island2 = gridBlocks(1, 1, { origin: [0.25, 0] });
  const island3 = gridBlocks(1, 1, { origin: [-0.1, 0] });
  const blocks = [...main, ...island1, ...island2, ...island3];
  const topo = buildTopology(blocks);

  it('matches brute-force nearest-neighbor for all bridges', () => {
    // Verify each bridge connects an island to its nearest in the growing main component
    expect(topo.bridges).toHaveLength(3);
    // island1 (index 3) nearest to main[2]
    expect(topo.bridges).toContainEqual([2, 3]);
    // After island1 merges, island2 (index 4) is nearest to island1 now in main
    expect(topo.bridges).toContainEqual([3, 4]);
    // island3 (index 5) nearest to main[0]
    expect(topo.bridges).toContainEqual([0, 5]);
    // All blocks should be connected
    expect(isConnected(topo, Int32Array.from([0, 1, 2, 3, 4, 5]))).toBe(true);
  });
});

describe('determinism: scattered islands (checkerboard)', () => {
  const main = gridBlocks(10, 10, { skip: (x, y) => (x + y) % 2 === 1 });
  const topo = buildTopology(main);

  it('produces deterministic bridges that are valid', () => {
    // All bridges should have been computed without error
    expect(topo.bridges.length).toBeGreaterThan(0);
    // All bridges should be valid index pairs with no -1
    for (const [a, b] of topo.bridges) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(a).not.toBe(b);
    }
    // Verify determinism: running again yields identical bridges
    const topo2 = buildTopology(main);
    expect(topo2.bridges).toEqual(topo.bridges);
  });
});

describe('large component spread: 50k blocks', () => {
  it('handles large disconnected grids without throw, exactly 1 bridge', () => {
    const main = gridBlocks(200, 125); // ~25k blocks
    const bigIsland = gridBlocks(250, 200, { origin: [3.0, 0] }); // ~50k blocks, far away
    const blocks = [...main, ...bigIsland];

    const start = performance.now();
    const topo = buildTopology(blocks);
    const elapsed = performance.now() - start;

    // Should complete (grid search is slower for large islands; no specific time constraint)
    expect(elapsed).toBeLessThan(60000);
    // Exactly one bridge between the two components
    expect(topo.bridges).toHaveLength(1);
    // All blocks should be connected via the bridge
    const allIndices = Int32Array.from({ length: blocks.length }, (_, i) => i);
    expect(isConnected(topo, allIndices)).toBe(true);
  });
});
