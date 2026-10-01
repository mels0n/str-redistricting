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

/** Convert [lon, lat] in degrees to 3D unit vector on sphere. */
function toVec3(lonLat: LonLat): [number, number, number] {
  const [lonDeg, latDeg] = lonLat;
  const lon = lonDeg * Math.PI / 180;
  const lat = latDeg * Math.PI / 180;
  const cosLat = Math.cos(lat);
  return [cosLat * Math.cos(lon), cosLat * Math.sin(lon), Math.sin(lat)];
}

/** Euclidean chord distance between two 3D vectors. */
function chord(a: [number, number, number], b: [number, number, number]): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
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
  const main = [...members[mainId]!];
  const bridges: [number, number][] = [];

  // Build 3D spatial grid for efficient nearest-neighbor search
  const S = 0.0005; // cell side in unit-sphere units (~3.2 km)
  const grid = new Map<string, number[]>();
  const vec3s = blocks.map(b => toVec3(b.point));

  const addToGrid = (blockIdx: number) => {
    const [x, y, z] = vec3s[blockIdx]!;
    const ix = Math.floor(x / S);
    const iy = Math.floor(y / S);
    const iz = Math.floor(z / S);
    const key = `${ix},${iy},${iz}`;
    const cell = grid.get(key) ?? [];
    cell.push(blockIdx);
    grid.set(key, cell);
  };
  for (const idx of main) addToGrid(idx);

  for (let c = 0; c < members.length; c++) {
    if (c === mainId) continue;
    let best: [number, number] = [-1, -1];
    let bestD = Infinity;

    for (const u of members[c]!) {
      const uVec = vec3s[u]!;
      const [ux, uy, uz] = uVec;
      const uix = Math.floor(ux / S);
      const uiy = Math.floor(uy / S);
      const uiz = Math.floor(uz / S);

      // Search Chebyshev shells r = 0, 1, 2, ... up to a reasonable limit
      // For practical applications, USA is ~60 cells wide (0.873 radians / 0.0005)
      const maxR = Math.min(200, Math.ceil(2 / S) + 1); // Cap at 200 rings for performance
      for (let r = 0; r <= maxR; r++) {
        // Stop if any block in shell r+1 or beyond has chord >= r*S, so great-circle distance >= R*r*S
        // But only if we've found at least one candidate (bestD is finite)
        if (r > 0 && isFinite(bestD) && bestD < EARTH_RADIUS_M * r * S) break;

        // Search all cells with max(|dx|, |dy|, |dz|) === r (Chebyshev shell)
        // Optimize by only checking cells that exist in the grid
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            for (let dz = -r; dz <= r; dz++) {
              // Only cells on the shell boundary
              if (r > 0 && Math.abs(dx) < r && Math.abs(dy) < r && Math.abs(dz) < r) continue;

              const cellX = uix + dx;
              const cellY = uiy + dy;
              const cellZ = uiz + dz;
              const key = `${cellX},${cellY},${cellZ}`;
              const cell = grid.get(key);
              if (!cell) continue;

              for (const v of cell) {
                const d = greatCircleDistance(blocks[u]!.point, blocks[v]!.point);
                const pair: [number, number] = u < v ? [u, v] : [v, u];
                if (d < bestD || (d === bestD && (pair[0] < best[0] || (pair[0] === best[0] && pair[1] < best[1])))) {
                  bestD = d;
                  best = pair;
                }
              }
            }
          }
        }
      }
    }

    if (best[0] === -1) {
      throw new DataError(`bridgeComponents: component ${c} block ${members[c]![0]!} found no nearest main block`);
    }

    nbr[best[0]]!.add(best[1]);
    nbr[best[1]]!.add(best[0]);
    bridges.push(best);

    // Add merged component to grid
    for (const idx of members[c]!) addToGrid(idx);
    // Append to main without spread operator to avoid RangeError
    for (const idx of members[c]!) main.push(idx);
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
