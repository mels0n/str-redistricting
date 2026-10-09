import { describe, expect, it } from 'vitest';
import { boundarySegments, buildTopology, forEachEdge, isConnected, type Block } from '../../../src/server/entities/census-block/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';
import { greatCircleDistance, type LonLat } from '../../../src/server/shared/geo/index.js';
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

/** Pieces joined by shared rounded edges alone (rook adjacency), found independently of the engine. */
function piecesOf(blocks: readonly Block[]): { comp: number[]; members: number[][] } {
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
  return { comp, members };
}

const pieceOf = (blocks: readonly Block[]): number[] => piecesOf(blocks).comp;

/** Independent brute-force definition of the bridges: nearest-first growth from the largest piece. */
function bruteForceBridges(blocks: readonly Block[]): [number, number][] {
  const { members } = piecesOf(blocks);
  if (members.length <= 1) return [];
  let mainId = 0;
  for (let c = 1; c < members.length; c++) if (members[c]!.length > members[mainId]!.length) mainId = c;
  // Grow from the main body: each round, scan every joined x unjoined pair and take the nearest.
  const joined = [...members[mainId]!];
  const left = new Set(members.keys());
  left.delete(mainId);
  const bridges: [number, number][] = [];
  while (left.size) {
    let best: [number, number] = [-1, -1];
    let bestD = Infinity;
    let bestC = -1;
    for (const c of left) {
      for (const u of members[c]!) {
        for (const v of joined) {
          const d = greatCircleDistance(blocks[u]!.point, blocks[v]!.point);
          const pair: [number, number] = u < v ? [u, v] : [v, u];
          if (d < bestD || (d === bestD && (pair[0] < best[0] || (pair[0] === best[0] && pair[1] < best[1])))) {
            bestD = d;
            best = pair;
            bestC = c;
          }
        }
      }
    }
    bridges.push(best);
    left.delete(bestC);
    for (const u of members[bestC]!) joined.push(u);
  }
  return bridges;
}

/** Total great-circle length of a set of links, in metres. */
const totalLength = (blocks: readonly Block[], links: readonly (readonly [number, number])[]): number =>
  links.reduce((sum, [u, v]) => sum + greatCircleDistance(blocks[u]!.point, blocks[v]!.point), 0);

/** Links as a sorted list of "lo,hi" strings, for comparing sets regardless of order. */
const linkSet = (links: readonly (readonly [number, number])[]): string[] =>
  links.map(([u, v]) => (u < v ? `${u},${v}` : `${v},${u}`)).sort();

/**
 * Independent definition by the other classic construction: list every pair of blocks in different pieces, shortest
 * first, and keep a pair whenever it joins two pieces not yet joined. Equals the nearest-first growth when no two
 * candidate pairs are exactly the same length.
 */
function shortestTreeBridges(blocks: readonly Block[]): [number, number][] {
  const piece = pieceOf(blocks);
  const pairs: [number, number, number][] = [];
  for (let u = 0; u < blocks.length; u++) {
    for (let v = u + 1; v < blocks.length; v++) {
      if (piece[u] !== piece[v]) pairs.push([greatCircleDistance(blocks[u]!.point, blocks[v]!.point), u, v]);
    }
  }
  pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
  const parent = new Map<number, number>();
  const find = (x: number): number => { while (parent.has(x)) x = parent.get(x)!; return x; };
  const out: [number, number][] = [];
  for (const [, u, v] of pairs) {
    const a = find(piece[u]!), b = find(piece[v]!);
    if (a === b) continue;
    parent.set(a, b);
    out.push([u, v]);
  }
  return out;
}

describe('buildTopology', () => {
  const blocks = gridBlocks(2, 2); // indices: 0=(0,0) 1=(1,0) 2=(0,1) 3=(1,1)
  const topo = buildTopology(blocks);

  it('connects blocks that share an edge, not a corner', () => {
    expect(neighbors(topo, 0)).toEqual([1, 2]);
    expect(neighbors(topo, 3)).toEqual([1, 2]);
  });
  it('finds the outer boundary of the whole grid', () => {
    expect(boundarySegments(topo, Int32Array.from([0, 1, 2, 3])).count).toBe(8);
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

  it('bridges several islands nearest first, each to the nearest joined block', () => {
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

  it('links an island to a nearer island even when that island comes later in block order', () => {
    const blocks = [
      ...main, // 0..2, centers at x = 0.005, 0.015, 0.025
      ...gridBlocks(1, 1, { origin: [0.15, 0], indexOffset: 100 }), // 3, far: 0.13 to main, 0.05 to block 4
      ...gridBlocks(1, 1, { origin: [0.1, 0], indexOffset: 200 }), // 4, near: 0.08 to main
    ];
    const topo3 = buildTopology(blocks);
    expect(topo3.bridges).toEqual([[2, 4], [3, 4]]);
    expect(topo3.bridges).toEqual(bruteForceBridges(blocks));
  });
});

describe('island links are the shortest set that joins every piece', () => {
  const pieces = (): Block[] => [...gridBlocks(5, 5), ...scatter(60, [-0.3, -0.3], [0.7, 0.7], 12345)];

  it('equals the shortest tree over the pieces, built shortest link first (no order, no main body)', () => {
    for (const blocks of [pieces(), [...gridBlocks(3, 3), ...scatter(25, [-0.2, -0.2], [0.5, 0.5], 4242)]]) {
      const topo = buildTopology(blocks);
      expect(linkSet(topo.bridges)).toEqual(linkSet(shortestTreeBridges(blocks)));
    }
  });

  it('does not depend on how blocks are numbered', () => {
    const blocks = pieces();
    const base = buildTopology(blocks);
    // Reverse every other position: position p of the shuffled list holds original block order[p].
    const n = blocks.length;
    const order = Array.from({ length: n }, (_, i) => (i % 2 === 0 ? n - 1 - i : i));
    const topo = buildTopology(order.map((orig) => blocks[orig]!));
    const back = topo.bridges.map(([u, v]) => [order[u]!, order[v]!] as [number, number]);
    expect(linkSet(back)).toEqual(linkSet(base.bridges));
  });
});

describe('bridging equals brute force'
, () => {
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

/** Straightforward string-keyed reference: adjacency and summed shared-edge lengths per pair. */
function referenceAdjacency(blocks: readonly Block[]): { nbr: number[][]; len: Map<string, number> } {
  const r = (v: number) => v.toFixed(7);
  const owners = new Map<string, { a: LonLat; b: LonLat; blocks: number[] }>();
  blocks.forEach((blk, i) => {
    for (const ring of blk.rings) {
      for (let k = 0; k + 1 < ring.length; k++) {
        const p = ring[k]!, q = ring[k + 1]!;
        const kp = `${r(p[0])},${r(p[1])}`, kq = `${r(q[0])},${r(q[1])}`;
        if (kp === kq) continue;
        const key = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
        const e = owners.get(key) ?? { a: p, b: q, blocks: [] };
        if (!e.blocks.includes(i)) e.blocks.push(i);
        owners.set(key, e);
      }
    }
  });
  const nbr: number[][] = blocks.map(() => []);
  const len = new Map<string, number>();
  for (const e of owners.values()) {
    for (const u of e.blocks) {
      for (const v of e.blocks) {
        if (u === v) continue;
        if (!nbr[u]!.includes(v)) nbr[u]!.push(v);
        len.set(`${u},${v}`, (len.get(`${u},${v}`) ?? 0) + greatCircleDistance(e.a, e.b));
      }
    }
  }
  return { nbr: nbr.map((l) => l.sort((a, b) => a - b)), len };
}

describe('typed-array edge matching', () => {
  it('equals a string-keyed reference on a ~5,000-block irregular grid', () => {
    const blocks = gridBlocks(80, 80, { skip: (x, y) => (x * 7 + y * 13 + x * y) % 5 === 0 });
    expect(blocks.length).toBeGreaterThan(4500);
    expect(blocks.length).toBeLessThan(5500);
    const topo = buildTopology(blocks);
    const ref = referenceAdjacency(blocks);
    const bridged = new Set(topo.bridges.flatMap(([u, v]) => [`${u},${v}`, `${v},${u}`]));
    for (let i = 0; i < blocks.length; i++) {
      const got = neighbors(topo, i);
      const want = [...ref.nbr[i]!];
      for (const [u, v] of topo.bridges) {
        if (u === i) want.push(v);
        if (v === i) want.push(u);
      }
      expect(got).toEqual([...new Set(want)].sort((a, b) => a - b));
      for (let k = topo.adjOffsets[i]!; k < topo.adjOffsets[i + 1]!; k++) {
        const j = topo.adjList[k]!;
        const key = `${i},${j}`;
        if (bridged.has(key) && !ref.len.has(key)) expect(topo.adjLength[k]).toBe(0);
        else expect(topo.adjLength[k]).toBeCloseTo(ref.len.get(key)!, 6);
      }
    }
  });

  it('gives a neighbour pair the great-circle length of its shared edge', () => {
    const topo = buildTopology(gridBlocks(2, 1)); // shared edge (0.01, 0) to (0.01, 0.01)
    const want = greatCircleDistance([0.01, 0], [0.01, 0.01]);
    expect(topo.adjLength[topo.adjOffsets[0]!]).toBeCloseTo(want, 2);
    expect(topo.adjLength[topo.adjOffsets[1]!]).toBeCloseTo(want, 2);
  });

  it('counts every distinct edge of a grid once, with its owners', () => {
    const topo = buildTopology(gridBlocks(3, 2));
    expect(topo.edgeCount).toBe(17);
    let shared = 0;
    forEachEdge(topo, (_a, _b, owners) => { if (owners.length === 2) shared++; });
    expect(shared).toBe(7);
  });
});
