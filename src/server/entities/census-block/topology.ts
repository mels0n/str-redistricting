import { DataError } from '../../shared/errors/index.js';
import { EARTH_RADIUS_M, greatCircleDistance, type LonLat } from '../../shared/geo/index.js';
import type { Block } from './model.js';

export interface TopoEdge {
  readonly a: LonLat;
  readonly b: LonLat;
  readonly blocks: readonly number[];
}

export interface Topology {
  readonly n: number;
  readonly adjOffsets: Int32Array;
  readonly adjList: Int32Array;
  readonly edges: readonly TopoEdge[];
  readonly bridges: readonly (readonly [number, number])[];
}

const vkey = (p: LonLat): string => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;

export function buildTopology(blocks: readonly Block[]): Topology {
  const n = blocks.length;
  const edgeMap = new Map<string, { a: LonLat; b: LonLat; blocks: number[] }>();
  for (let i = 0; i < n; i++) {
    for (const ring of blocks[i]!.rings) {
      for (let k = 0; k + 1 < ring.length; k++) {
        const p = ring[k]!;
        const q = ring[k + 1]!;
        const kp = vkey(p);
        const kq = vkey(q);
        if (kp === kq) continue;
        const forward = kp < kq;
        const key = forward ? `${kp}|${kq}` : `${kq}|${kp}`;
        let e = edgeMap.get(key);
        if (!e) {
          e = { a: forward ? p : q, b: forward ? q : p, blocks: [] };
          edgeMap.set(key, e);
        }
        if (!e.blocks.includes(i)) e.blocks.push(i);
      }
    }
  }
  const edges = [...edgeMap.values()];

  const nbr: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (const e of edges) {
    for (const u of e.blocks) for (const v of e.blocks) if (u !== v) nbr[u]!.add(v);
  }

  const bridges = bridgeComponents(blocks, nbr);

  const adjOffsets = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) adjOffsets[i + 1] = adjOffsets[i]! + nbr[i]!.size;
  const adjList = new Int32Array(adjOffsets[n]!);
  for (let i = 0; i < n; i++) {
    const sorted = [...nbr[i]!].sort((a, b) => a - b);
    adjList.set(sorted, adjOffsets[i]!);
  }
  return { n, adjOffsets, adjList, edges, bridges };
}

/** Convert [lon, lat] in degrees to a 3D unit vector. */
function toVec3(lonLat: LonLat): [number, number, number] {
  const lon = (lonLat[0] * Math.PI) / 180;
  const lat = (lonLat[1] * Math.PI) / 180;
  const cosLat = Math.cos(lat);
  return [cosLat * Math.cos(lon), cosLat * Math.sin(lon), Math.sin(lat)];
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
      const shellCells = r === 0 ? 1 : (2 * r + 1) ** 3 - (2 * r - 1) ** 3;
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

/** Connect every disconnected component to the nearest block of the growing main component. */
function bridgeComponents(blocks: readonly Block[], nbr: Set<number>[]): [number, number][] {
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
      for (const v of nbr[u]!) if (comp[v] === -1) { comp[v] = id; stack.push(v); }
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
  const grid = new SphereGrid();
  for (const idx of members[mainId]!) grid.add(idx, vecs[idx]!);

  const bridges: [number, number][] = [];
  for (let c = 0; c < members.length; c++) {
    if (c === mainId) continue;
    const best = nearestToGrid(blocks, vecs, grid, members[c]!);
    if (best[0] === -1) throw new DataError(`component ${c} found no block in the main component`);
    nbr[best[0]]!.add(best[1]);
    nbr[best[1]]!.add(best[0]);
    bridges.push(best);
    for (const idx of members[c]!) grid.add(idx, vecs[idx]!);
  }
  return bridges;
}

export function isConnected(topo: Topology, members: Int32Array): boolean {
  if (members.length === 0) return false;
  const inSet = new Uint8Array(topo.n);
  for (const m of members) inSet[m] = 1;
  const seen = new Uint8Array(topo.n);
  const stack = [members[0]!];
  seen[members[0]!] = 1;
  let count = 0;
  while (stack.length) {
    const u = stack.pop()!;
    count++;
    for (let k = topo.adjOffsets[u]!; k < topo.adjOffsets[u + 1]!; k++) {
      const v = topo.adjList[k]!;
      if (inSet[v] && !seen[v]) { seen[v] = 1; stack.push(v); }
    }
  }
  return count === members.length;
}

export function boundarySegments(topo: Topology, members: Int32Array): TopoEdge[] {
  const inSet = new Uint8Array(topo.n);
  for (const m of members) inSet[m] = 1;
  const out: TopoEdge[] = [];
  for (const e of topo.edges) {
    let c = 0;
    for (const b of e.blocks) c += inSet[b]!;
    if (c === 1) out.push(e);
  }
  return out;
}
