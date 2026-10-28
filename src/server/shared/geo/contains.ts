import type { Geometry, Position } from 'geojson';
import type { LonLat } from './sphere.js';

/** Even-odd ray casting test of a point against one ring. */
function pointInRing(pt: LonLat, ring: readonly Position[]): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const ax = a[0]!, ay = a[1]!, bx = b[0]!, by = b[1]!;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function pointInPolygonRings(pt: LonLat, rings: readonly (readonly Position[])[]): boolean {
  const [outer, ...holes] = rings;
  if (!outer || !pointInRing(pt, outer)) return false;
  return !holes.some((h) => pointInRing(pt, h));
}

/** Point in a Polygon or MultiPolygon geometry; other geometry types never contain a point. */
export function pointInGeometry(pt: LonLat, geom: Geometry | null): boolean {
  if (!geom) return false;
  if (geom.type === 'Polygon') return pointInPolygonRings(pt, geom.coordinates);
  if (geom.type === 'MultiPolygon') return geom.coordinates.some((p) => pointInPolygonRings(pt, p));
  return false;
}

/** The published map files draw Alaska in one continuous frame: eastern-hemisphere longitudes continue past -180. */
export function toStateFrame(abbr: string, pt: LonLat): LonLat {
  return abbr === 'AK' && pt[0] > 0 ? [pt[0] - 360, pt[1]] : pt;
}
