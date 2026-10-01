import { describe, expect, it } from 'vitest';
import { boundarySegments, buildTopology, isConnected } from '../../../src/server/entities/census-block/index.js';
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
