import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { LAND_FILE, readBoundaryZip, StateRecord } from '../../../features/publish/index.js';
import { simplifyRing } from '../../../features/rule-examples/index.js';
import { asin, atan2, cos, sin } from '../../../shared/detmath/index.js';
import { DataError } from '../../../shared/errors/index.js';
import type { LonLat } from '../../../shared/geo/index.js';

/** A point in panel units. */
export type P = [number, number];

const RAD = Math.PI / 180;
const r1 = (v: number): number => Math.round(v * 10) / 10;
export const round1 = (p: readonly [number, number]): P => [r1(p[0]), r1(p[1])];
/** A zero-length line, which the panel draws as a round dot. */
export const dot = (p: readonly [number, number]): P[] => [round1(p), round1(p)];

export const whole = (n: number): string => n.toLocaleString('en-US');
/** People counts: whole numbers as they are, a fractional share to two decimals. */
export const people = (n: number): string =>
  Number.isInteger(n) ? whole(n) : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The segment a-b clipped to the rectangle [0, w] x [0, h], or undefined when it misses (Liang-Barsky). */
export function clip(a: P, b: P, w: number, h: number): [P, P] | undefined {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, a[0]], [dx, w - a[0]], [-dy, a[1]], [dy, h - a[1]]] as const) {
    if (p === 0) { if (q < 0) return undefined; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return undefined; if (r > t0) t0 = r; }
    else { if (r < t0) return undefined; if (r < t1) t1 = r; }
  }
  return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
}

/** Foot of the perpendicular from p onto the infinite line through a and b. */
export function foot(p: P, a: P, b: P): P {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  return [a[0] + t * dx, a[1] + t * dy];
}

/**
 * Fit points given north-up (x east, y north) into a w by h panel with a margin, uniform scale, centered.
 * Returns the map from those coordinates to panel units (y down).
 */
export function fit(points: readonly (readonly [number, number])[], w: number, h: number, pad: number): (p: readonly [number, number]) => P {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const s = Math.min((w - 2 * pad) / (x1 - x0 || 1), (h - 2 * pad) / (y1 - y0 || 1));
  const ox = (w - (x1 - x0) * s) / 2, oy = (h - (y1 - y0) * s) / 2;
  return ([x, y]) => [ox + (x - x0) * s, oy + (y1 - y) * s];
}

const toVec = ([lon, lat]: LonLat): [number, number, number] => {
  const l = lon * RAD, p = lat * RAD, c = cos(p);
  return [c * cos(l), c * sin(l), sin(p)];
};

/** n + 1 points on the great circle from a to b, ends included. */
export function greatCircle(a: LonLat, b: LonLat, n: number): LonLat[] {
  const va = toVec(a), vb = toVec(b);
  const out: LonLat[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = va[0] + (vb[0] - va[0]) * t, y = va[1] + (vb[1] - va[1]) * t, z = va[2] + (vb[2] - va[2]) * t;
    const len = Math.sqrt(x * x + y * y + z * z);
    out.push([atan2(y, x) / RAD, asin(z / len) / RAD]);
  }
  return out;
}

const Position = z.tuple([z.number(), z.number()]).rest(z.number());
const Rings = z.array(z.array(Position).min(4));
const Geometry = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: Rings }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(Rings) }),
]);

const ringArea = (ring: readonly (readonly number[])[]): number => {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    s += a[0]! * b[1]! - b[0]! * a[1]!;
  }
  return Math.abs(s) / 2;
};

/**
 * The outer ring of a state's largest land polygon from the Census cartographic file (display only), without
 * the repeated closing point, simplified in degrees until it has at most `maxPoints` points.
 */
export async function stateOutline(rawDir: string, abbr: string, maxPoints: number): Promise<LonLat[]> {
  const zip = join(rawDir, `${LAND_FILE}.zip`);
  if (!existsSync(zip)) throw new DataError(`${zip} is missing; run npm run publish-data once to download it`);
  const feature = (await readBoundaryZip(zip, LAND_FILE)).find((f) => StateRecord.safeParse(f.properties).data?.STUSPS === abbr);
  if (!feature) throw new DataError(`${LAND_FILE}: no outline for ${abbr}`);
  const g = Geometry.safeParse(feature.geometry);
  if (!g.success) throw new DataError(`${LAND_FILE}: bad geometry for ${abbr}`);
  const polys = g.data.type === 'Polygon' ? [g.data.coordinates] : g.data.coordinates;
  let best: (readonly number[])[] = [];
  for (const poly of polys) if (ringArea(poly[0]!) > ringArea(best)) best = poly[0]!;
  let ring: P[] = best.map((p) => [p[0]!, p[1]!]);
  ring.pop();
  for (let tol = 0.001; ring.length > maxPoints; tol *= 2) ring = simplifyRing(ring, tol);
  return ring;
}

/** Insert points along every edge of a closed lon/lat ring so no step is longer than `stepDeg`; returns the ring closed. */
export function densify(ring: readonly LonLat[], stepDeg: number): LonLat[] {
  const out: LonLat[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / stepDeg));
    for (let j = 0; j < n; j++) out.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  out.push(out[0]!);
  return out;
}
