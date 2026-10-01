import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Topology } from '../../entities/census-block/index.js';
import type { LonLat } from '../../shared/geo/index.js';

const round = (p: LonLat) => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6];

export function bordersGeoJson(topo: Topology, assignment: Int32Array, seats: number): object {
  const lines: number[][][][] = Array.from({ length: seats }, () => []);
  for (const e of topo.edges) {
    const counts = new Map<number, number>();
    for (const b of e.blocks) counts.set(assignment[b]!, (counts.get(assignment[b]!) ?? 0) + 1);
    for (const [d, c] of counts) if (c === 1) lines[d]!.push([round(e.a), round(e.b)]);
  }
  return {
    type: 'FeatureCollection',
    features: lines.map((coordinates, d) => ({
      type: 'Feature',
      properties: { district: d + 1 },
      geometry: { type: 'MultiLineString', coordinates },
    })),
  };
}

export function cutsGeoJson(cuts: readonly { depth: number; angleDeg: number; lengthM: number; spans: readonly (readonly [LonLat, LonLat])[] }[]): object {
  return {
    type: 'FeatureCollection',
    features: cuts.map((c, i) => ({
      type: 'Feature',
      properties: { order: i + 1, depth: c.depth, angleDeg: c.angleDeg, lengthM: Math.round(c.lengthM) },
      geometry: { type: 'MultiLineString', coordinates: c.spans.map(([p, q]) => [round(p), round(q)]) },
    })),
  };
}

/** Filled district shapes: chain each district's boundary edges into closed rings, then nest rings into shells and holes. */
export function districtsGeoJson(topo: Topology, assignment: Int32Array, seats: number): object {
  const segsByDistrict: [LonLat, LonLat][][] = Array.from({ length: seats }, () => []);
  for (const e of topo.edges) {
    const counts = new Map<number, number>();
    for (const b of e.blocks) counts.set(assignment[b]!, (counts.get(assignment[b]!) ?? 0) + 1);
    for (const [d, c] of counts) if (c === 1) segsByDistrict[d]!.push([e.a, e.b]);
  }
  return {
    type: 'FeatureCollection',
    features: segsByDistrict.map((segs, d) => ({
      type: 'Feature',
      properties: { district: d + 1 },
      geometry: { type: 'MultiPolygon', coordinates: nestRings(chainRings(segs)).map((poly) => poly.map((ring) => ring.map(round))) },
    })),
  };
}

const pkey = (p: LonLat) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;

/** Walk unused segments end to end until each loop closes. */
function chainRings(segs: [LonLat, LonLat][]): LonLat[][] {
  const at = new Map<string, number[]>();
  segs.forEach(([a, b], i) => {
    for (const p of [a, b]) {
      const k = pkey(p);
      if (!at.has(k)) at.set(k, []);
      at.get(k)!.push(i);
    }
  });
  const used = new Uint8Array(segs.length);
  const rings: LonLat[][] = [];
  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const start = segs[s]![0];
    const ring: LonLat[] = [start, segs[s]![1]];
    let cur = segs[s]![1];
    while (pkey(cur) !== pkey(start)) {
      const next = at.get(pkey(cur))!.find((i) => !used[i]);
      if (next === undefined) break;
      used[next] = 1;
      const [a, b] = segs[next]!;
      cur = pkey(a) === pkey(cur) ? b : a;
      ring.push(cur);
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

const area = (r: LonLat[]) => r.reduce((s, p, i) => (i === 0 ? s : s + (r[i - 1]![0] * p[1] - p[0] * r[i - 1]![1])), 0) / 2;

function contains(ring: LonLat[], p: LonLat): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Rings nested an even number of levels deep are shells; odd ones are holes of the ring directly around them. */
function nestRings(rings: LonLat[][]): LonLat[][][] {
  const sorted = [...rings].sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
  const probe = (r: LonLat[]): LonLat => {
    const a = r[0]!, b = r[1]!;
    return [(a[0] + b[0]) / 2 + (b[1] - a[1]) * 1e-9, (a[1] + b[1]) / 2 - (b[0] - a[0]) * 1e-9];
  };
  const polys: LonLat[][][] = [];
  const shellOf = new Map<LonLat[], LonLat[][]>();
  sorted.forEach((r, i) => {
    const parents = sorted.slice(0, i).filter((q) => contains(q, probe(r)));
    const direct = parents[parents.length - 1];
    if (parents.length % 2 === 0) {
      const poly = [r];
      polys.push(poly);
      shellOf.set(r, poly);
    } else if (direct) {
      shellOf.get(direct)?.push(r);
    }
  });
  return polys;
}

export async function writePlan(dir: string, files: Record<string, string>): Promise<void> {
  await mkdir(dir, { recursive: true });
  await Promise.all(Object.entries(files).map(([name, body]) => writeFile(join(dir, name), body)));
}
