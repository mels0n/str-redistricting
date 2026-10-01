import { describe, expect, it } from 'vitest';
import { boundarySegments, buildTopology, isConnected, type Block } from '../../../src/server/entities/census-block/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';
import { greatCircleDistance } from '../../../src/server/shared/geo/index.js';
import { gridBlocks } from '../../helpers/grid.js';

const neighbors = (t: ReturnType<typeof buildTopology>, i: number) =>
  Array.from(t.adjList.subarray(t.adjOffsets[i]!, t.adjOffsets[i + 1]!)).sort((a, b) => a - b);

/** Square block with its internal point at the center unless given. */
function square(x0: number, y0: number, size: number, tag: number, point?: [number, number]): Block {
  const x1 = x0 + size, y1 = y0 + size;
  return {
    geoid: `00000${String(tag).padStart(10, '0')}`,
    pop: 1,
    point: point ?? [x0 + size / 2, y0 + size / 2],
    rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
  };
}

/** Deterministic scatter of small isolated squares inside a lon/lat box. */
function scatter(count: number, origin: [number, number], span: [number, number], seed: number): Block[] {
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  return Array.from({ length: count }, (_, i) =>
    square(origin[0] + rnd() * span[0], origin[1] + rnd() * span[1], 0.002, 1000 + i));
}

/** Independent brute-force definition of the bridges (rook adjacency by shared rounded edges). */
function bruteForceBridges(blocks: readonly Block[]): [number, number][] {
  const n = blocks.length;
  const r = (v: number) => v.toFixed(7);
  const owners = new Map<string, number[]>();
  blocks.forEach((b, i) => {
    for (const ring of b.rings) {
      for (let k = 0; k + 1 < ring.length; k++) {
        const p = `${r(ring[k]![0])},${r(ring[k]![1])}`;
        const q = `${r(ring[k + 1]![0])},${r(ring[k + 1]![1])}`;
        const key = p < q ? `${p}|${q}` : `${q}|${p}`;
        const list = owners.get(key) ?? [];
        if (!list.includes(i)) list.push(i);
        owners.set(key, list);
      }
    }
  });
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const list of owners.values()) for (const u of list) for (const v of list) if (u !== v) adj[u]!.push(v);

  const comp = new Array<number>(n).fill(-1);
  const members: number[][] = [];
  for (let s = 0; s < n; s++) {
    if (comp[s] !== -1) continue;
    const id = members.length;
    const list: number[] = [];
    const stack = [s];
    comp[s] = id;
    while (stack.length) {
      const u = stack.pop()!;
      list.push(u);
      for (const v of adj[u]!) if (comp[v] === -1) { comp[v] = id; stack.push(v); }
    }
    members.push(list);
  }
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
    for (const u of members[c]!) main.push(u);
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

  it('bridges several islands in component order, each to the growing main', () => {
    const blocks = [
      ...main,
      ...gridBlocks(1, 1, { origin: [0.05, 0], indexOffset: 100 }), // 3, nearest to block 2
      ...gridBlocks(1, 1, { origin: [0, 0.1], indexOffset: 200 }), // 4, nearest to block 0
      ...gridBlocks(1, 1, { origin: [-0.2, 0], indexOffset: 300 }), // 5, nearest to block 0
    ];
    const topo3 = buildTopology(blocks);
    expect(topo3.bridges).toEqual([[2, 3], [0, 4], [0, 5]]);
    expect(topo3.bridges).toEqual(bruteForceBridges(blocks));
    expect(isConnected(topo3, Int32Array.from(blocks.map((_, i) => i)))).toBe(true);
  });
});

describe('bridging equals brute force', () => {
  it('matches on a checkerboard of 50 isolated blocks (many distance ties)', () => {
    const blocks = gridBlocks(10, 10, { skip: (x, y) => (x + y) % 2 === 1 });
    expect(blocks).toHaveLength(50);
    const topo = buildTopology(blocks);
    expect(topo.bridges).toHaveLength(49);
    expect(topo.bridges).toEqual(bruteForceBridges(blocks));
  });

  it('matches on scattered islands around a main grid', () => {
    const blocks = [...gridBlocks(5, 5), ...scatter(60, [-0.3, -0.3], [0.7, 0.7], 12345)];
    const topo = buildTopology(blocks);
    expect(topo.bridges.length).toBeGreaterThan(40);
    expect(topo.bridges).toEqual(bruteForceBridges(blocks));
  });

  it('matches near 71 degrees north', () => {
    const blocks = [
      ...gridBlocks(4, 4, { origin: [-156.8, 71.2] }),
      ...scatter(12, [-157.2, 71.0], [0.8, 0.5], 777),
    ];
    const topo = buildTopology(blocks);
    expect(topo.bridges.length).toBeGreaterThan(5);
    expect(topo.bridges).toEqual(bruteForceBridges(blocks));
  });

  it('finds far islands 5 degrees from main (no premature stop)', () => {
    const blocks = [
      ...gridBlocks(3, 3),
      ...gridBlocks(2, 2, { origin: [5, 0.01], indexOffset: 100, skip: (x, y) => x === 1 && y === 1 }),
      ...gridBlocks(1, 1, { origin: [0.01, -5], indexOffset: 200 }),
    ];
    const topo = buildTopology(blocks);
    expect(topo.bridges).toHaveLength(2);
    expect(topo.bridges).toEqual(bruteForceBridges(blocks));
  });

  it('picks the truly nearest point, not the nearest cell-aligned one', () => {
    const island = square(0.04, 0.04, 0.02, 3, [0.0499, 0.0499]);
    const a = square(0.09, 0.01, 0.02, 1, [0.0999, 0.0199]);
    const b = square(0.09, 0.03, 0.02, 2, [0.1001, 0.0499]);
    const blocks = [a, b, island];
    const topo = buildTopology(blocks);
    expect(topo.bridges).toEqual([[1, 2]]);
    expect(topo.bridges).toEqual(bruteForceBridges(blocks));
  });
});

describe('large components', () => {
  it('bridges a 120,000-block second component without throwing', () => {
    const blocks = [
      ...gridBlocks(400, 320),
      ...gridBlocks(400, 300, { origin: [6, 0], indexOffset: 500_000 }),
    ];
    expect(blocks).toHaveLength(248_000);
    const topo = buildTopology(blocks);
    expect(topo.bridges).toHaveLength(1);
    expect(topo.bridges[0]![0]).toBeLessThan(128_000);
    expect(topo.bridges[0]![1]).toBeGreaterThanOrEqual(128_000);
  }, 180_000);
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
    expect(() => buildTopology([valid, invalid])).toThrow(DataError);
  });
});
