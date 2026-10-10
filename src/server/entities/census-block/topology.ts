import { cos, sin } from '../../shared/detmath/index.js';
import { DataError } from '../../shared/errors/index.js';
import { EARTH_RADIUS_M, greatCircleDistance, type LonLat } from '../../shared/geo/index.js';
import type { Block } from './model.js';

/**
 * Block adjacency and shared-edge geometry in typed arrays.
 * Edge e runs from (edgeA[2e], edgeA[2e+1]) to (edgeB[2e], edgeB[2e+1]) in lon/lat degrees and is
 * shared by blocks edgeBlockList[edgeBlockOffsets[e] .. edgeBlockOffsets[e+1]). Edges appear in the
 * order they are first met walking blocks, rings and segments. adjLength[k] is the great-circle length
 * in meters of the border shared by block u and adjList[k] (0 for bridges).
 */
export interface Topology {
  readonly n: number;
  readonly adjOffsets: Int32Array;
  readonly adjList: Int32Array;
  readonly adjLength: Float64Array;
  readonly edgeCount: number;
  readonly edgeA: Float64Array;
  readonly edgeB: Float64Array;
  readonly edgeBlockOffsets: Int32Array;
  readonly edgeBlockList: Int32Array;
  readonly bridges: readonly (readonly [number, number])[];
}

/** Boundary segments in compact form: segment i runs from (a[2i], a[2i+1]) to (b[2i], b[2i+1]). */
export interface BoundarySegments {
  readonly count: number;
  readonly a: Float64Array;
  readonly b: Float64Array;
}

const SCALE = 1e7;

/** Growable Int32 buffer. */
class IntBuf {
  data: Int32Array;
  length = 0;
  constructor(capacity = 1024) { this.data = new Int32Array(capacity); }
  push(v: number): void {
    if (this.length === this.data.length) {
      const next = new Int32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = v;
  }
}

/** Dense ids for distinct fixed-point vertices, found with an open-addressing table in typed arrays. */
class VertexTable {
  private slots = new Int32Array(1 << 16); // vertex id + 1, 0 = empty
  private mask = (1 << 16) - 1;
  private xs = new Int32Array(1 << 15);
  private ys = new Int32Array(1 << 15);
  size = 0;

  private static hash(x: number, y: number): number {
    let h = Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 13;
    return h;
  }

  id(x: number, y: number): number {
    let s = VertexTable.hash(x, y) & this.mask;
    for (;;) {
      const v = this.slots[s]!;
      if (v === 0) break;
      if (this.xs[v - 1] === x && this.ys[v - 1] === y) return v - 1;
      s = (s + 1) & this.mask;
    }
    if (this.size === this.xs.length) {
      const nx = new Int32Array(this.size * 2);
      const ny = new Int32Array(this.size * 2);
      nx.set(this.xs);
      ny.set(this.ys);
      this.xs = nx;
      this.ys = ny;
    }
    const id = this.size++;
    this.xs[id] = x;
    this.ys[id] = y;
    this.slots[s] = id + 1;
    if (this.size * 2 > this.slots.length) this.rehash();
    return id;
  }

  private rehash(): void {
    const slots = new Int32Array(this.slots.length * 2);
    const mask = slots.length - 1;
    for (let id = 0; id < this.size; id++) {
      let s = VertexTable.hash(this.xs[id]!, this.ys[id]!) & mask;
      while (slots[s] !== 0) s = (s + 1) & mask;
      slots[s] = id + 1;
    }
    this.slots = slots;
    this.mask = mask;
  }
}

/** Unique block edges in first-seen order, as typed arrays. */
interface EdgeSet {
  readonly count: number;
  readonly edgeA: Float64Array;
  readonly edgeB: Float64Array;
  readonly offsets: Int32Array;
  readonly list: Int32Array;
}

/**
 * Match segments by sorting: every segment record is bucketed by its lower endpoint id (counting sort),
 * each small bucket is ordered by its upper endpoint, and runs of equal pairs are one edge.
 */
function buildEdges(blocks: readonly Block[]): EdgeSet {
  const n = blocks.length;
  let total = 0;
  for (let i = 0; i < n; i++) for (const ring of blocks[i]!.rings) if (ring.length > 1) total += ring.length - 1;

  // Pass 1: one record per non-degenerate segment, in walk order.
  const vt = new VertexTable();
  const recLo = new Int32Array(total);
  const recHi = new Int32Array(total);
  const recBlock = new Int32Array(total);
  let S = 0;
  for (let i = 0; i < n; i++) {
    for (const ring of blocks[i]!.rings) {
      if (ring.length < 2) continue;
      let prev = vt.id(Math.round(ring[0]![0] * SCALE), Math.round(ring[0]![1] * SCALE));
      for (let k = 1; k < ring.length; k++) {
        const cur = vt.id(Math.round(ring[k]![0] * SCALE), Math.round(ring[k]![1] * SCALE));
        if (cur !== prev) {
          recLo[S] = prev < cur ? prev : cur;
          recHi[S] = prev < cur ? cur : prev;
          recBlock[S] = i;
          S++;
        }
        prev = cur;
      }
    }
  }
  const V = vt.size;

  // Counting sort of record ids by lower endpoint; ids stay ascending inside a bucket.
  const bucket = new Int32Array(V + 1);
  for (let r = 0; r < S; r++) bucket[recLo[r]! + 1]!++;
  for (let v = 0; v < V; v++) bucket[v + 1] = bucket[v + 1]! + bucket[v]!;
  const order = new Int32Array(S);
  {
    const cursor = bucket.slice(0, V);
    for (let r = 0; r < S; r++) order[cursor[recLo[r]!]!++] = r;
  }

  // Scan buckets: runs of equal upper endpoint are one edge owned by the distinct blocks in the run.
  const firstRec = new IntBuf(1 << 20);
  const ownerOff = new IntBuf(1 << 20);
  const owners = new IntBuf(1 << 21);
  ownerOff.push(0);
  for (let v = 0; v < V; v++) {
    const s = bucket[v]!, e = bucket[v + 1]!;
    if (e - s > 1) {
      if (e - s <= 48) {
        for (let i = s + 1; i < e; i++) {
          const r = order[i]!, h = recHi[r]!;
          let j = i - 1;
          while (j >= s && recHi[order[j]!]! > h) { order[j + 1] = order[j]!; j--; }
          order[j + 1] = r;
        }
      } else {
        const tmp = Array.from(order.subarray(s, e)).sort((p, q) => recHi[p]! - recHi[q]! || p - q);
        order.set(tmp, s);
      }
    }
    for (let i = s; i < e; ) {
      const h = recHi[order[i]!]!;
      firstRec.push(order[i]!);
      let lastBlock = -1;
      let j = i;
      for (; j < e && recHi[order[j]!] === h; j++) {
        const b = recBlock[order[j]!]!;
        if (b !== lastBlock) { owners.push(b); lastBlock = b; }
      }
      ownerOff.push(owners.length);
      i = j;
    }
  }
  const E = firstRec.length;

  // Put edges in first-seen order by scattering them over their first record id.
  const slotEdge = order; // reuse: bucket order is no longer needed
  slotEdge.fill(-1);
  for (let e = 0; e < E; e++) slotEdge[firstRec.data[e]!] = e;
  const sortedFirst = new Int32Array(E);
  const offsets = new Int32Array(E + 1);
  const list = new Int32Array(owners.length);
  {
    let ei = 0, w = 0;
    for (let r = 0; r < S && ei < E; r++) {
      const e = slotEdge[r]!;
      if (e < 0) continue;
      sortedFirst[ei] = r;
      const from = ownerOff.data[e]!, to = ownerOff.data[e + 1]!;
      list.set(owners.data.subarray(from, to), w);
      w += to - from;
      offsets[++ei] = w;
    }
  }

  // Pass 2: original coordinates of each edge's first record, oriented low to high in fixed point.
  const edgeA = new Float64Array(2 * E);
  const edgeB = new Float64Array(2 * E);
  {
    let rid = 0, ei = 0;
    for (let i = 0; i < n && ei < E; i++) {
      for (const ring of blocks[i]!.rings) {
        for (let k = 0; k + 1 < ring.length && ei < E; k++) {
          const p = ring[k]!, q = ring[k + 1]!;
          const px = Math.round(p[0] * SCALE), py = Math.round(p[1] * SCALE);
          const qx = Math.round(q[0] * SCALE), qy = Math.round(q[1] * SCALE);
          if (px === qx && py === qy) continue;
          if (rid++ !== sortedFirst[ei]) continue;
          const forward = px < qx || (px === qx && py < qy);
          const a = forward ? p : q, b = forward ? q : p;
          edgeA[2 * ei] = a[0]; edgeA[2 * ei + 1] = a[1];
          edgeB[2 * ei] = b[0]; edgeB[2 * ei + 1] = b[1];
          ei++;
        }
      }
    }
  }
  return { count: E, edgeA, edgeB, offsets, list };
}

interface Adjacency {
  readonly offsets: Int32Array;
  readonly list: Int32Array;
  readonly length: Float64Array;
}

/** Rook adjacency with the summed length of the borders each pair shares. */
function buildAdjacency(n: number, edges: EdgeSet): Adjacency {
  const { count, edgeA, edgeB, offsets: eo, list: el } = edges;
  const rawOff = new Int32Array(n + 1);
  for (let e = 0; e < count; e++) {
    const k = eo[e + 1]! - eo[e]!;
    if (k < 2) continue;
    for (let i = eo[e]!; i < eo[e + 1]!; i++) rawOff[el[i]! + 1]! += k - 1;
  }
  for (let i = 0; i < n; i++) rawOff[i + 1] = rawOff[i + 1]! + rawOff[i]!;
  const rawList = new Int32Array(rawOff[n]!);
  const rawLen = new Float64Array(rawOff[n]!);
  const cursor = rawOff.slice(0, n);
  const pa: [number, number] = [0, 0], pb: [number, number] = [0, 0];
  for (let e = 0; e < count; e++) {
    const from = eo[e]!, to = eo[e + 1]!;
    if (to - from < 2) continue;
    pa[0] = edgeA[2 * e]!; pa[1] = edgeA[2 * e + 1]!;
    pb[0] = edgeB[2 * e]!; pb[1] = edgeB[2 * e + 1]!;
    const len = greatCircleDistance(pa, pb);
    for (let i = from; i < to; i++) {
      for (let j = from; j < to; j++) {
        if (i === j) continue;
        const c = cursor[el[i]!]!++;
        rawList[c] = el[j]!;
        rawLen[c] = len;
      }
    }
  }

  // Order each block's neighbours, merging repeats (several shared edges) by summing their lengths.
  const offsets = new Int32Array(n + 1);
  let w = 0;
  for (let u = 0; u < n; u++) {
    const s = rawOff[u]!, e = rawOff[u + 1]!;
    if (e - s > 1) {
      if (e - s <= 48) {
        for (let i = s + 1; i < e; i++) {
          const v = rawList[i]!, l = rawLen[i]!;
          let j = i - 1;
          while (j >= s && rawList[j]! > v) { rawList[j + 1] = rawList[j]!; rawLen[j + 1] = rawLen[j]!; j--; }
          rawList[j + 1] = v; rawLen[j + 1] = l;
        }
      } else {
        const idx = Array.from({ length: e - s }, (_, i) => s + i).sort((p, q) => rawList[p]! - rawList[q]! || p - q);
        const vs = idx.map((i) => rawList[i]!), ls = idx.map((i) => rawLen[i]!);
        rawList.set(vs, s); rawLen.set(ls, s);
      }
    }
    for (let i = s; i < e; i++) {
      if (w > offsets[u]! && rawList[w - 1] === rawList[i]) rawLen[w - 1] = rawLen[w - 1]! + rawLen[i]!;
      else { rawList[w] = rawList[i]!; rawLen[w] = rawLen[i]!; w++; }
    }
    offsets[u + 1] = w;
  }
  return { offsets, list: rawList.slice(0, w), length: rawLen.slice(0, w) };
}

/** Add bridge pairs (length 0) to a sorted adjacency. */
function withBridges(n: number, adj: Adjacency, bridges: readonly (readonly [number, number])[]): Adjacency {
  if (bridges.length === 0) return adj;
  const extra = new Map<number, number[]>();
  const add = (u: number, v: number) => { const l = extra.get(u); if (l) l.push(v); else extra.set(u, [v]); };
  for (const [u, v] of bridges) { add(u, v); add(v, u); }
  const offsets = new Int32Array(n + 1);
  for (let u = 0; u < n; u++) offsets[u + 1] = offsets[u]! + (adj.offsets[u + 1]! - adj.offsets[u]!) + (extra.get(u)?.length ?? 0);
  const list = new Int32Array(offsets[n]!);
  const length = new Float64Array(offsets[n]!);
  for (let u = 0; u < n; u++) {
    const ex = (extra.get(u) ?? []).sort((a, b) => a - b);
    let w = offsets[u]!, x = 0;
    for (let k = adj.offsets[u]!; k < adj.offsets[u + 1]!; k++) {
      while (x < ex.length && ex[x]! < adj.list[k]!) { list[w] = ex[x++]!; w++; }
      list[w] = adj.list[k]!; length[w] = adj.length[k]!; w++;
    }
    while (x < ex.length) { list[w] = ex[x++]!; w++; }
  }
  return { offsets, list, length };
}

export function buildTopology(blocks: readonly Block[]): Topology {
  const n = blocks.length;
  const edges = buildEdges(blocks);
  const rook = buildAdjacency(n, edges);
  const bridges = bridgeComponents(blocks, rook.offsets, rook.list);
  const adj = withBridges(n, rook, bridges);
  return {
    n,
    adjOffsets: adj.offsets,
    adjList: adj.list,
    adjLength: adj.length,
    edgeCount: edges.count,
    edgeA: edges.edgeA,
    edgeB: edges.edgeB,
    edgeBlockOffsets: edges.offsets,
    edgeBlockList: edges.list,
    bridges,
  };
}

/** Visit every edge in order; `blocks` is a view into the topology and must not be kept or modified. */
export function forEachEdge(topo: Topology, visit: (a: LonLat, b: LonLat, blocks: Int32Array) => void): void {
  for (let e = 0; e < topo.edgeCount; e++) {
    visit(
      [topo.edgeA[2 * e]!, topo.edgeA[2 * e + 1]!],
      [topo.edgeB[2 * e]!, topo.edgeB[2 * e + 1]!],
      topo.edgeBlockList.subarray(topo.edgeBlockOffsets[e]!, topo.edgeBlockOffsets[e + 1]!),
    );
  }
}

/** Convert [lon, lat] in degrees to a 3D unit vector. */
function toVec3(lonLat: LonLat): [number, number, number] {
  const lon = (lonLat[0] * Math.PI) / 180;
  const lat = (lonLat[1] * Math.PI) / 180;
  const cosLat = cos(lat);
  return [cosLat * cos(lon), cosLat * sin(lon), sin(lat)];
}

/** Cell side of the unit-sphere grid; unit coordinates lie in [-1, 1]. */
const CELL = 0.0005;
const CELL_OFFSET = Math.ceil(1 / CELL) + 1;
const CELL_BASE = 2 * CELL_OFFSET + 1;
/** Slack so floating-point differences between chord and haversine never cut a scan short. */
const BOUND_SLACK = 1 - 1e-9;

type Vec3 = readonly [number, number, number];

/** Uniform 3D grid over the unit sphere holding block indices, with the occupied cell extent. */
class SphereGrid {
  readonly cells = new Map<number, number[]>();
  readonly lo: [number, number, number] = [Infinity, Infinity, Infinity];
  readonly hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  /** Exact bounding box of the stored points. */
  readonly boxLo: [number, number, number] = [Infinity, Infinity, Infinity];
  readonly boxHi: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  static key(ix: number, iy: number, iz: number): number {
    return ((ix + CELL_OFFSET) * CELL_BASE + (iy + CELL_OFFSET)) * CELL_BASE + (iz + CELL_OFFSET);
  }

  static index(v: Vec3): [number, number, number] {
    return [Math.floor(v[0] / CELL), Math.floor(v[1] / CELL), Math.floor(v[2] / CELL)];
  }

  add(block: number, v: Vec3): void {
    const c = SphereGrid.index(v);
    for (let k = 0; k < 3; k++) {
      if (c[k]! < this.lo[k]!) this.lo[k] = c[k]!;
      if (c[k]! > this.hi[k]!) this.hi[k] = c[k]!;
      if (v[k]! < this.boxLo[k]!) this.boxLo[k] = v[k]!;
      if (v[k]! > this.boxHi[k]!) this.boxHi[k] = v[k]!;
    }
    const key = SphereGrid.key(c[0], c[1], c[2]);
    const cell = this.cells.get(key);
    if (cell) cell.push(block);
    else this.cells.set(key, [block]);
  }
}

/** Chord distance (unit sphere) between the bounding boxes of two grids; no stored pair is closer. */
function boxGap(a: SphereGrid, b: SphereGrid): number {
  let gap2 = 0;
  for (let k = 0; k < 3; k++) {
    const g = Math.max(a.boxLo[k]! - b.boxHi[k]!, b.boxLo[k]! - a.boxHi[k]!, 0);
    gap2 += g * g;
  }
  return Math.sqrt(gap2);
}

/**
 * Exact nearest-pair search from component members to the grid, equal to a brute-force scan:
 * minimum great-circle distance, ties to the smaller pair[0] then pair[1].
 */
function nearestToGrid(
  blocks: readonly Block[],
  vecs: readonly Vec3[],
  grid: SphereGrid,
  members: readonly number[],
): [number, number] {
  let best: [number, number] = [-1, -1];
  let bestD = Infinity;
  const consider = (u: number, v: number): void => {
    const d = greatCircleDistance(blocks[u]!.point, blocks[v]!.point);
    const lo = u < v ? u : v;
    const hi = u < v ? v : u;
    if (d < bestD || (d === bestD && (lo < best[0] || (lo === best[0] && hi < best[1])))) {
      bestD = d;
      best = [lo, hi];
    }
  };
  const [loX, loY, loZ] = grid.lo;
  const [hiX, hiY, hiZ] = grid.hi;

  for (const u of members) {
    // Every stored point is at least the chord distance to their bounding box away.
    const p = vecs[u]!;
    let gap2 = 0;
    for (let k = 0; k < 3; k++) {
      const g = Math.max(grid.boxLo[k]! - p[k]!, p[k]! - grid.boxHi[k]!, 0);
      gap2 += g * g;
    }
    if (bestD < EARTH_RADIUS_M * Math.sqrt(gap2) * BOUND_SLACK) continue;
    const [ux, uy, uz] = SphereGrid.index(p);
    // Beyond this radius every occupied cell has been visited.
    const maxR = Math.max(ux - loX, hiX - ux, uy - loY, hiY - uy, uz - loZ, hiZ - uz);
    for (let r = 0; r <= maxR; r++) {
      // Unscanned cells (shells >= r) differ by more than (r-1)*CELL in some coordinate.
      if (bestD < EARTH_RADIUS_M * (r - 1) * CELL * BOUND_SLACK) break;
      const shellCells = r === 0 ? 1 : (2 * r + 1) * (2 * r + 1) * (2 * r + 1) - (2 * r - 1) * (2 * r - 1) * (2 * r - 1);
      if (shellCells > grid.cells.size) {
        // Cheaper to filter every occupied cell than to enumerate empty shell positions.
        for (const [key, cell] of grid.cells) {
          const iz = (key % CELL_BASE) - CELL_OFFSET;
          const iy = (Math.floor(key / CELL_BASE) % CELL_BASE) - CELL_OFFSET;
          const ix = Math.floor(key / (CELL_BASE * CELL_BASE)) - CELL_OFFSET;
          if (Math.max(Math.abs(ix - ux), Math.abs(iy - uy), Math.abs(iz - uz)) < r) continue;
          for (const v of cell) consider(u, v);
        }
        break;
      }
      const x0 = Math.max(ux - r, loX), x1 = Math.min(ux + r, hiX);
      const y0 = Math.max(uy - r, loY), y1 = Math.min(uy + r, hiY);
      const z0 = Math.max(uz - r, loZ), z1 = Math.min(uz + r, hiZ);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iy = y0; iy <= y1; iy++) {
          const full = r === 0 || Math.abs(ix - ux) === r || Math.abs(iy - uy) === r;
          const step = full ? 1 : 2 * r;
          for (let iz = full ? z0 : uz - r; iz <= z1; iz += step) {
            if (iz < z0) continue;
            const cell = grid.cells.get(SphereGrid.key(ix, iy, iz));
            if (cell) for (const v of cell) consider(u, v);
          }
        }
      }
    }
  }
  return best;
}

/** Connect the disconnected components one shortest link at a time, returned in the order added. */
function bridgeComponents(blocks: readonly Block[], adjOffsets: Int32Array, adjList: Int32Array): [number, number][] {
  const n = blocks.length;
  const comp = new Int32Array(n).fill(-1);
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
      for (let k = adjOffsets[u]!; k < adjOffsets[u + 1]!; k++) {
        const v = adjList[k]!;
        if (comp[v] === -1) { comp[v] = id; stack.push(v); }
      }
    }
    members.push(list);
  }
  if (members.length <= 1) return [];
  let mainId = 0;
  for (let c = 1; c < members.length; c++) if (members[c]!.length > members[mainId]!.length) mainId = c;

  const vecs = blocks.map((b) => toVec3(b.point));
  for (let i = 0; i < n; i++) {
    if (!vecs[i]!.every(Number.isFinite)) throw new DataError(`block ${i} has a non-finite internal point`);
  }
  // Like a cut, take the shortest: of every possible link between the connected land (starting as the main body) and
  // a group not yet connected, add the shortest, then repeat. Together the links are the shortest set that connects
  // every group, so block numbering changes nothing except exact ties, which go to the lower block positions.
  const gridOf = (list: readonly number[]): SphereGrid => {
    const g = new SphereGrid();
    for (const idx of list) g.add(idx, vecs[idx]!);
    return g;
  };
  const mainGrid = gridOf(members[mainId]!);
  const pending: { c: number; box: SphereGrid; pair: [number, number]; d: number }[] = [];
  for (let c = 0; c < members.length; c++) {
    if (c === mainId) continue;
    const pair = nearestToGrid(blocks, vecs, mainGrid, members[c]!);
    if (pair[0] === -1) throw new DataError(`component ${c} found no block in the main component`);
    pending.push({ c, box: gridOf(members[c]!), pair, d: greatCircleDistance(blocks[pair[0]]!.point, blocks[pair[1]]!.point) });
  }
  const closer = (d: number, p: readonly [number, number], bestD: number, best: readonly [number, number]): boolean =>
    d < bestD || (d === bestD && (p[0] < best[0] || (p[0] === best[0] && p[1] < best[1])));

  const bridges: [number, number][] = [];
  while (pending.length) {
    let pick = 0;
    for (let i = 1; i < pending.length; i++) {
      if (closer(pending[i]!.d, pending[i]!.pair, pending[pick]!.d, pending[pick]!.pair)) pick = i;
    }
    const joined = pending.splice(pick, 1)[0]!;
    bridges.push(joined.pair);
    // The new group may now be the closest joined land for any group still waiting.
    for (const rest of pending) {
      if (rest.d < EARTH_RADIUS_M * boxGap(rest.box, joined.box) * BOUND_SLACK) continue;
      const pair = nearestToGrid(blocks, vecs, joined.box, members[rest.c]!);
      const d = greatCircleDistance(blocks[pair[0]]!.point, blocks[pair[1]]!.point);
      if (closer(d, pair, rest.d, rest.pair)) { rest.pair = pair; rest.d = d; }
    }
  }
  return bridges;
}

/**
 * Per-topology scratch so a connectivity check costs O(members), not O(n): stamp[v] === mark means
 * "in the set, not yet seen" and mark + 1 means "seen", for the current call's mark.
 */
const stamps = new WeakMap<Topology, { stamp: Int32Array; mark: number }>();

export function isConnected(topo: Topology, members: Int32Array): boolean {
  if (members.length === 0) return false;
  let s = stamps.get(topo);
  if (!s) { s = { stamp: new Int32Array(topo.n), mark: -1 }; stamps.set(topo, s); }
  if (s.mark > 0x7ffffff0) { s.stamp.fill(0); s.mark = -1; }
  const inSet = (s.mark += 2), seen = inSet + 1, stamp = s.stamp;
  for (const m of members) stamp[m] = inSet;
  const stack = [members[0]!];
  stamp[members[0]!] = seen;
  let count = 0;
  while (stack.length) {
    const u = stack.pop()!;
    count++;
    for (let k = topo.adjOffsets[u]!; k < topo.adjOffsets[u + 1]!; k++) {
      const v = topo.adjList[k]!;
      if (stamp[v] === inSet) { stamp[v] = seen; stack.push(v); }
    }
  }
  return count === members.length;
}

/** Per-topology scratch for keepsConnectedWithout: mark[v] === gen means v was reached in the current call, by group label[v]. */
const removals = new WeakMap<Topology, { mark: Int32Array; label: Int32Array; gen: number }>();

/**
 * PRECONDITION: the group must be one connected piece WITH the block; on any other group the answer means nothing.
 * Check that once with isConnected and keep it true across changes.
 *
 * Whether block `block`'s group (the blocks sharing its value in `group`) stays one connected piece without it.
 * Same answer as isConnected on the group minus the block, including false when the block is the group's only
 * one, but it only looks near the block.
 *
 * Removing the block can only cut paths that ran through it, and each such path enters and leaves through two of its
 * neighbours in the group. So the group stays connected exactly when those neighbours still reach each other
 * without the block. A search starts from every such neighbour at once, one block per search in turn; searches that
 * meet merge. All merged: connected. A search that runs out of blocks before meeting the rest has found a piece
 * cut off from them: not connected. So a success costs about the size of the loop around the block, and a failure
 * about the size of the smaller piece left behind.
 */
export function keepsConnectedWithout(topo: Topology, group: ArrayLike<number>, block: number): boolean {
  let s = removals.get(topo);
  if (!s) { s = { mark: new Int32Array(topo.n), label: new Int32Array(topo.n), gen: 0 }; removals.set(topo, s); }
  if (s.gen > 0x7ffffff0) { s.mark.fill(0); s.gen = 0; }
  const gen = ++s.gen, { mark, label } = s, g = group[block]!;
  mark[block] = gen;
  label[block] = -1;
  const queues: number[][] = [];
  for (let k = topo.adjOffsets[block]!; k < topo.adjOffsets[block + 1]!; k++) {
    const v = topo.adjList[k]!;
    if (group[v] !== g || mark[v] === gen) continue;
    mark[v] = gen;
    label[v] = queues.length;
    queues.push([v]);
  }
  // No neighbour in the group: the block was its only block. One: removing a tip strands nothing.
  if (queues.length <= 1) return queues.length === 1;
  const parent = queues.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!; return i; };
  const heads = queues.map(() => 0);
  let open = queues.length;
  for (;;) {
    for (let q = 0; q < queues.length; q++) {
      if (parent[q] !== q) continue;
      const queue = queues[q]!;
      if (heads[q] === queue.length) return false;
      const u = queue[heads[q]!++]!;
      for (let k = topo.adjOffsets[u]!; k < topo.adjOffsets[u + 1]!; k++) {
        const v = topo.adjList[k]!;
        if (group[v] !== g) continue;
        if (mark[v] !== gen) { mark[v] = gen; label[v] = q; queue.push(v); continue; }
        if (label[v]! < 0) continue;
        const r = find(label[v]!);
        if (r === q) continue;
        // The searches met: fold r's unexplored blocks into q's queue and carry on as one.
        parent[r] = q;
        const other = queues[r]!;
        for (let i = heads[r]!; i < other.length; i++) queue.push(other[i]!);
        if (--open === 1) return true;
      }
    }
  }
}

export function boundarySegments(topo: Topology, members: Int32Array): BoundarySegments {
  const inSet = new Uint8Array(topo.n);
  for (const m of members) inSet[m] = 1;
  const picked = new IntBuf(1024);
  for (let e = 0; e < topo.edgeCount; e++) {
    let c = 0;
    for (let k = topo.edgeBlockOffsets[e]!; k < topo.edgeBlockOffsets[e + 1]!; k++) c += inSet[topo.edgeBlockList[k]!]!;
    if (c === 1) picked.push(e);
  }
  const a = new Float64Array(2 * picked.length), b = new Float64Array(2 * picked.length);
  for (let i = 0; i < picked.length; i++) {
    const e = picked.data[i]!;
    a[2 * i] = topo.edgeA[2 * e]!; a[2 * i + 1] = topo.edgeA[2 * e + 1]!;
    b[2 * i] = topo.edgeB[2 * e]!; b[2 * i + 1] = topo.edgeB[2 * e + 1]!;
  }
  return { count: picked.length, a, b };
}
