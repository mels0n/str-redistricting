import { DataError } from '../../shared/errors/index.js';
import { greatCircleDistance, type LonLat } from '../../shared/geo/index.js';
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

  // Build spatial grid for efficient nearest-neighbor search
  const cellSize = 0.05; // degrees
  const grid = new Map<string, number[]>();
  const addToGrid = (blockIdx: number) => {
    const [lon, lat] = blocks[blockIdx]!.point;
    const cellX = Math.floor(lon / cellSize);
    const cellY = Math.floor(lat / cellSize);
    const key = `${cellX},${cellY}`;
    const cell = grid.get(key) ?? [];
    cell.push(blockIdx);
    grid.set(key, cell);
  };
  for (const idx of main) addToGrid(idx);

  // Conservative distance bound: degrees to meters (111km per degree lat, adjusted for lon by max state latitude)
  const boundForRing = (ring: number): number => {
    if (ring === 0) return 0;
    // Assume max US latitude ~49° (Alaska), cos(49°) ≈ 0.656
    const metersPerDegreeLon = 111000 * 0.656;
    const metersPerDegreeLat = 111000;
    return Math.min(ring * cellSize * metersPerDegreeLat, ring * cellSize * metersPerDegreeLon);
  };

  for (let c = 0; c < members.length; c++) {
    if (c === mainId) continue;
    let best: [number, number] = [-1, -1];
    let bestD = Infinity;

    for (const u of members[c]!) {
      const [uLon, uLat] = blocks[u]!.point;
      const uCellX = Math.floor(uLon / cellSize);
      const uCellY = Math.floor(uLat / cellSize);

      // Search rings of cells outward
      let found = false;
      for (let ring = 0; ring <= 100; ring++) {
        const ringBound = boundForRing(ring);
        if (ringBound > bestD) break; // Stop if ring is too far

        // Search all cells at this ring distance
        for (let dx = -ring; dx <= ring; dx++) {
          for (let dy = -ring; dy <= ring; dy++) {
            // Only check cells on the ring boundary (not interior already checked)
            if (ring > 0 && Math.abs(dx) < ring && Math.abs(dy) < ring) continue;

            const cellX = uCellX + dx;
            const cellY = uCellY + dy;
            const key = `${cellX},${cellY}`;
            const cell = grid.get(key);
            if (!cell) continue;

            for (const v of cell) {
              const d = greatCircleDistance(blocks[u]!.point, blocks[v]!.point);
              const pair: [number, number] = u < v ? [u, v] : [v, u];
              if (d < bestD || (d === bestD && (pair[0] < best[0] || (pair[0] === best[0] && pair[1] < best[1])))) {
                bestD = d;
                best = pair;
                found = true;
              }
            }
          }
        }
        if (found && ringBound > bestD) break;
      }

      // Fallback to brute force if grid search found nothing
      if (best[0] === -1) {
        for (const v of main) {
          const d = greatCircleDistance(blocks[u]!.point, blocks[v]!.point);
          const pair: [number, number] = u < v ? [u, v] : [v, u];
          if (d < bestD || (d === bestD && (pair[0] < best[0] || (pair[0] === best[0] && pair[1] < best[1])))) {
            bestD = d;
            best = pair;
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
