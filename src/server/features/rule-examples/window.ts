import type { Block, BlockPolygons } from '../../entities/census-block/index.js';
import { gnomonic, type LonLat } from '../../shared/geo/index.js';

type P = [number, number];

export interface ProjectedWindow {
  project(p: LonLat): P;
  rings: Map<string, P[]>;
}

const SIMPLIFY = 0.6;
const round1 = (v: number): number => Math.round(v * 10) / 10;

function perpendicular(p: P, a: P, b: P): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return Math.sqrt((p[0] - a[0]) * (p[0] - a[0]) + (p[1] - a[1]) * (p[1] - a[1]));
  return Math.abs(dx * (a[1] - p[1]) - (a[0] - p[0]) * dy) / len;
}

/** Douglas-Peucker on an open polyline; keeps both ends. */
function simplifyLine(pts: P[], tol: number): P[] {
  if (pts.length < 3) return pts;
  const first = pts[0]!, last = pts[pts.length - 1]!;
  let worst = -1, at = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpendicular(pts[i]!, first, last);
    if (d > worst) { worst = d; at = i; }
  }
  if (worst <= tol) return [first, last];
  return [...simplifyLine(pts.slice(0, at + 1), tol).slice(0, -1), ...simplifyLine(pts.slice(at), tol)];
}

/** Douglas-Peucker on a closed ring (no repeated closing point): split at the point farthest from the start. */
export function simplifyRing(ring: P[], tol: number): P[] {
  if (ring.length <= 3) return ring;
  let far = 0, best = -1;
  for (let i = 1; i < ring.length; i++) {
    const ex = ring[i]![0] - ring[0]![0], ey = ring[i]![1] - ring[0]![1];
    const d = ex * ex + ey * ey;
    if (d > best) { best = d; far = i; }
  }
  const a = simplifyLine(ring.slice(0, far + 1), tol);
  const b = simplifyLine([...ring.slice(far), ring[0]!], tol);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return out.length >= 3 ? out : ring.slice(0, 3);
}

const area = (ring: readonly P[]): number => {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]!, [x2, y2] = ring[(i + 1) % ring.length]!;
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
};

/**
 * Project the blocks of a window onto a w by h panel (north up, uniform scale, centered, `pad` margin).
 * Outer ring only (the largest part of a multipart block), simplified at 0.6 panel units, 1-decimal coordinates.
 */
export function projectWindow(
  blocks: readonly Block[],
  polys: ReadonlyMap<string, BlockPolygons>,
  view: { w: number; h: number },
  pad = 8,
): ProjectedWindow {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  const outer = new Map<string, LonLat[]>();
  for (const b of blocks) {
    const poly = polys.get(b.geoid);
    if (!poly) continue;
    let best: LonLat[] | undefined, bestArea = -1;
    for (const rings of poly) {
      const ring = rings[0];
      if (!ring || ring.length < 3) continue;
      const a = area(ring.map((p) => [p[0], p[1]] as P));
      if (a > bestArea) { bestArea = a; best = [...ring]; }
    }
    if (!best) continue;
    // GeoJSON rings repeat the first point at the end; drop it.
    const last = best[best.length - 1]!;
    if (best.length > 3 && last[0] === best[0]![0] && last[1] === best[0]![1]) best.pop();
    outer.set(b.geoid, best);
    for (const [lon, lat] of best) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  if (outer.size === 0) return { project: () => [view.w / 2, view.h / 2], rings: new Map() };

  const g = gnomonic([(minLon + maxLon) / 2, (minLat + maxLat) / 2]);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const ring of outer.values()) {
    for (const p of ring) {
      const [x, y] = g.forward(p);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const dx = x1 - x0, dy = y1 - y0;
  const scale = Math.min(dx > 0 ? (view.w - 2 * pad) / dx : Infinity, dy > 0 ? (view.h - 2 * pad) / dy : Infinity);
  const k = Number.isFinite(scale) ? scale : 1;
  const ox = (view.w - dx * k) / 2, oy = (view.h - dy * k) / 2;
  const project = (p: LonLat): P => {
    const [x, y] = g.forward(p);
    return [ox + (x - x0) * k, oy + (y1 - y) * k];
  };
  const rings = new Map<string, P[]>();
  for (const [geoid, ring] of outer) {
    rings.set(geoid, simplifyRing(ring.map(project), SIMPLIFY).map(([x, y]) => [round1(x), round1(y)] as P));
  }
  return { project, rings };
}
