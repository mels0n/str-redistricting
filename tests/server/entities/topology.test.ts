import { describe, expect, it } from 'vitest';
import { boundarySegments, buildTopology, isConnected, type Block } from '../../../src/server/entities/census-block/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';
import { greatCircleDistance } from '../../../src/server/shared/geo/index.js';
import { gridBlocks } from '../../helpers/grid.js';

const neighbors = (t: ReturnType<typeof buildTopology>, i: number) =>
  Array.from(t.adjList.subarray(t.adjOffsets[i]!, t.adjOffsets[i + 1]!)).sort((a, b) => a - b);

/** Brute-force bridge simulation: process components in id order, find nearest pair via greatCircleDistance. */
function bruteForceBridges(blocks: Block[]): [number, number][] {
  // Find components
  const adjList: Set<number>[] = [];
  for (let i = 0; i < blocks.length; i++) {
    adjList[i] = new Set();
  }
  // For this test, treat as all disconnected (no edges)
  const comp = new Int32Array(blocks.length).fill(-1);
  const members: number[][] = [];
  for (let s = 0; s < blocks.length; s++) {
    if (comp[s] !== -1) continue;
    const id = members.length;
    comp[s] = id;
    members.push([s]);
  }

  if (members.length <= 1) return [];
  let mainId = 0;
  for (let c = 1; c < members.length; c++) if (members[c]!.length > members[mainId]!.length) mainId = c;
  const main = [...members[mainId]!];
  const bridges: [number, number][] = [];

  for (let c = 0; c < members.length; c++) {
    if (c === mainId) continue;
    let best: [number, number] = [-1, -1];
    let bestD = Infinity;

    for (const u of members[c]!) {
      for (const v of main) {
        const d = greatCircleDistance(blocks[u]!.point, blocks[v]!.point);
        const pair: [number, number] = u < v ? [u, v] : [v, u];
        if (d < bestD || (d === bestD && (pair[0] < best[0] || (pair[0] === best[0] && pair[1] < best[1])))) {
          bestD = d;
          best = pair;
        }
      }
    }
    bridges.push(best);
    main.push(...members[c]!);
  }
  return bridges;
}

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


describe('NaN internal point throws DataError', () => {
  it('throws DataError when a block has NaN coordinates', () => {
    const valid: Block = {
      geoid: '0000000001',
      pop: 1,
      point: [0, 0],
      rings: [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], [0, 0]]],
    };
    const invalid: Block = {
      geoid: '0000000002',
      pop: 1,
      point: [NaN, NaN],
      rings: [[[0.02, 0], [0.03, 0], [0.03, 0.01], [0.02, 0.01], [0.02, 0]]],
    };
    const blocks = [valid, invalid];

    expect(() => buildTopology(blocks)).toThrow(DataError);
  });
});
