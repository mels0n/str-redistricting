import { describe, expect, it } from 'vitest';
import type { Block, Topology } from '../../../src/server/entities/census-block/index.js';
import { balance } from '../../../src/server/features/balance/index.js';

/** A topology from an edge list [u, v, meters]; only the adjacency arrays balance reads are filled. */
function topologyOf(n: number, edges: readonly (readonly [number, number, number])[]): Topology {
  const nbr: [number, number][][] = Array.from({ length: n }, () => []);
  for (const [u, v, m] of edges) { nbr[u]!.push([v, m]); nbr[v]!.push([u, m]); }
  for (const l of nbr) l.sort((a, b) => a[0] - b[0]);
  const adjOffsets = new Int32Array(n + 1);
  for (let u = 0; u < n; u++) adjOffsets[u + 1] = adjOffsets[u]! + nbr[u]!.length;
  const flat = nbr.flat();
  const adjLength = Float64Array.from(flat, ([, m]) => m);
  return {
    n, adjOffsets, adjList: Int32Array.from(flat, ([v]) => v), adjLength,
    adjLengthUm: Float64Array.from(adjLength, (m) => Math.round(m * 1e6)),
    edgeCount: 0, edgeA: new Float64Array(0), edgeB: new Float64Array(0),
    edgeBlockOffsets: new Int32Array(1), edgeBlockList: new Int32Array(0), bridges: [],
  };
}

const block = (i: number): Block => ({ geoid: String(i).padStart(15, '0'), pop: 1, point: [i, 0], rings: [] });

describe('balance ties', () => {
  it('compares border changes in whole micrometers, so a last-bit float difference does not outrank GEOID order', () => {
    // District 0 = blocks 0..3 (4 people), district 1 = blocks 4, 5 (2 people). Blocks 0 and 1 each touch district 1
    // through a zero-length link, so moving either gains the same and lengthens the border by the length it shares
    // with district 0: 0.1 + 0.2 for block 0 (0.30000000000000004 as floats), 0.3 for block 1. In micrometers both
    // are 300000, so the tie goes to the lower block index.
    expect(0.1 + 0.2).toBeGreaterThan(0.3);
    const topo = topologyOf(6, [[0, 2, 0.1], [0, 3, 0.2], [0, 4, 0], [1, 2, 0.3], [1, 5, 0], [2, 3, 1], [4, 5, 1]]);
    const blocks = Array.from({ length: 6 }, (_, i) => block(i));
    const borders: (number | undefined)[] = [];
    const r = balance(blocks, topo, Int32Array.from([0, 0, 0, 0, 1, 1]), 2, {
      onRound: (round) => { if (borders.length === 0) borders.push(...round.candidates.filter((c) => c.allowed !== undefined && c.border !== undefined).map((c) => c.border)); },
    });
    expect(r.moves[0]!.block).toBe(0);
    // The observed border change is still in meters, the whole micrometers divided by a million.
    expect(borders.slice(0, 2)).toEqual([0.3, 0.3]);
  });
});
