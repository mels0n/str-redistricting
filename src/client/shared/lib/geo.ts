import type { Geometry, MultiPolygon, Polygon, Position } from 'geojson';

export type LonLat = readonly [number, number];
export type BBox = [number, number, number, number];

/**
 * States whose land lies on both sides of the 180th meridian. The published map files draw them in one
 * continuous frame, with the eastern-hemisphere longitudes continuing past -180 (172 becomes -188).
 */
const ACROSS_ANTIMERIDIAN: ReadonlySet<string> = new Set(['AK']);

export const crossesAntimeridian = (abbr: string): boolean => ACROSS_ANTIMERIDIAN.has(abbr);

/** A point from the address search (longitude -180 to 180) in the frame the state's map is drawn in. */
export function toStateFrame(abbr: string, pt: LonLat): LonLat {
  return crossesAntimeridian(abbr) && pt[0] > 0 ? [pt[0] - 360, pt[1]] : pt;
}

/**
 * Where a state's map first opens, when that is not the box around everything drawn. Hawaii's district
 * shapes run 1,500 miles up the chain of uninhabited northwestern islands; the map opens on the eight
 * main islands, and the rest is a pan away.
 */
const OPENING_VIEW: Readonly<Record<string, BBox>> = { HI: [-160.6, 18.8, -154.7, 22.3] };

export function openingBox(abbr: string, all: BBox): BBox {
  return OPENING_VIEW[abbr] ?? all;
}

/** Even-odd ray casting test of a point against one ring. */
export function pointInRing(pt: LonLat, ring: readonly Position[]): boolean {
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

/** True when the point is inside the polygon (outer ring minus its holes). */
export function pointInPolygonRings(pt: LonLat, rings: readonly (readonly Position[])[]): boolean {
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

function extend(b: BBox, p: Position): void {
  const x = p[0]!, y = p[1]!;
  if (x < b[0]) b[0] = x;
  if (y < b[1]) b[1] = y;
  if (x > b[2]) b[2] = x;
  if (y > b[3]) b[3] = y;
}

/** Bounding box [west, south, east, north] of polygon geometries. */
export function bboxOf(geoms: readonly (Geometry | null)[]): BBox | null {
  const b: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const g of geoms) {
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const poly of polys) for (const ring of poly) for (const p of ring) extend(b, p);
  }
  return Number.isFinite(b[0]) ? b : null;
}

function ringArea(ring: readonly Position[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j]![0]! - ring[i]![0]!) * (ring[j]![1]! + ring[i]![1]!);
  }
  return Math.abs(a) / 2;
}

/** Distance from a point to a segment, squared, in coordinate units. */
function segDistSq(px: number, py: number, a: Position, b: Position): number {
  let x = a[0]!, y = a[1]!;
  let dx = b[0]! - x, dy = b[1]! - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]!; y = b[1]!; } else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = px - x; dy = py - y;
  return dx * dx + dy * dy;
}

/** Signed distance from a point to the polygon outline: positive inside. */
function signedDist(x: number, y: number, rings: readonly (readonly Position[])[]): number {
  let inside = false;
  let min = Infinity;
  for (const ring of rings) {
    for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
      const a = ring[i]!, b = ring[j]!;
      if (a[1]! > y !== b[1]! > y && x < ((b[0]! - a[0]!) * (y - a[1]!)) / (b[1]! - a[1]!) + a[0]!) inside = !inside;
      min = Math.min(min, segDistSq(x, y, a, b));
    }
  }
  return (inside ? 1 : -1) * Math.sqrt(min);
}

/**
 * Pole of inaccessibility (the point inside the polygon farthest from its
 * edge), found by quadtree search. Used to place a district's number where it
 * reads best. Longitude is scaled by cos(latitude) so the result is not
 * skewed east-west.
 */
export function poleOfInaccessibility(rings: readonly (readonly Position[])[], precisionRatio = 0.01): LonLat {
  const outer = rings[0];
  if (!outer || outer.length === 0) return [0, 0];
  const b: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of outer) extend(b, p);
  const k = Math.cos((((b[1] + b[3]) / 2) * Math.PI) / 180) || 1;
  const scaled = rings.map((r) => r.map((p) => [p[0]! * k, p[1]!] as Position));
  const minX = b[0] * k, maxX = b[2] * k, minY = b[1], maxY = b[3];
  const width = maxX - minX, height = maxY - minY;
  const cellSize = Math.min(width, height);
  if (cellSize === 0) return [outer[0]![0]!, outer[0]![1]!];
  const precision = Math.max(cellSize * precisionRatio, 1e-9);

  type Cell = { x: number; y: number; h: number; d: number; max: number };
  const cell = (x: number, y: number, h: number): Cell => {
    const d = signedDist(x, y, scaled);
    return { x, y, h, d, max: d + h * Math.SQRT2 };
  };
  const queue: Cell[] = [];
  let h = cellSize / 2;
  for (let x = minX; x < maxX; x += cellSize) for (let y = minY; y < maxY; y += cellSize) queue.push(cell(x + h, y + h, h));

  // Start from the centroid of the outer ring as a reasonable first guess.
  let best = cell(minX + width / 2, minY + height / 2, 0);
  let guard = 0;
  while (queue.length && guard++ < 20000) {
    let idx = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i]!.max > queue[idx]!.max) idx = i;
    const c = queue.splice(idx, 1)[0]!;
    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) continue;
    h = c.h / 2;
    queue.push(cell(c.x - h, c.y - h, h), cell(c.x + h, c.y - h, h), cell(c.x - h, c.y + h, h), cell(c.x + h, c.y + h, h));
  }
  return [best.x / k, best.y];
}

/** Label point of a Polygon or MultiPolygon: the pole of its largest part. */
export function labelPoint(geom: Polygon | MultiPolygon): LonLat {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  let largest = polys[0] ?? [];
  let area = -1;
  for (const p of polys) {
    const a = p[0] ? ringArea(p[0]) : 0;
    if (a > area) { area = a; largest = p; }
  }
  return poleOfInaccessibility(largest);
}

/** The point a fraction `frac` (0 to 1) of the way along the longest of a cut's lines. */
export function pointAlongLines(lines: readonly (readonly Position[])[], frac: number): LonLat | null {
  let bestLine: readonly Position[] | null = null;
  let bestLen = -1;
  for (const line of lines) {
    let len = 0;
    for (let i = 1; i < line.length; i++) len += Math.hypot(line[i]![0]! - line[i - 1]![0]!, line[i]![1]! - line[i - 1]![1]!);
    if (len > bestLen) { bestLen = len; bestLine = line; }
  }
  if (!bestLine || bestLine.length === 0) return null;
  const target = bestLen * Math.max(0, Math.min(1, frac));
  let acc = 0;
  for (let i = 1; i < bestLine.length; i++) {
    const a = bestLine[i - 1]!, b = bestLine[i]!;
    const seg = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
    if (acc + seg >= target && seg > 0) {
      const t = (target - acc) / seg;
      return [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t];
    }
    acc += seg;
  }
  return [bestLine[0]![0]!, bestLine[0]![1]!];
}

/** Midpoint, by length, of the longest segment run in a cut's lines. */
export function lineLabelPoint(lines: readonly (readonly Position[])[]): LonLat | null {
  return pointAlongLines(lines, 0.5);
}

/**
 * Part of each line drawn so far, for progress t in [0, 1], measured along the
 * combined length of all the lines. Used to draw a cut as it is made.
 */
export function partialLines(lines: readonly (readonly Position[])[], t: number): Position[][] {
  if (t >= 1) return lines.map((l) => l.map((p) => [p[0]!, p[1]!]));
  const lens = lines.map((l) => {
    let len = 0;
    for (let i = 1; i < l.length; i++) len += Math.hypot(l[i]![0]! - l[i - 1]![0]!, l[i]![1]! - l[i - 1]![1]!);
    return len;
  });
  let budget = Math.max(0, t) * lens.reduce((a, b) => a + b, 0);
  const out: Position[][] = [];
  lines.forEach((line) => {
    if (budget <= 0 || line.length === 0) return;
    const part: Position[] = [[line[0]![0]!, line[0]![1]!]];
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1]!, b = line[i]!;
      const seg = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!);
      if (seg <= budget) { part.push([b[0]!, b[1]!]); budget -= seg; continue; }
      const f = seg === 0 ? 0 : budget / seg;
      part.push([a[0]! + (b[0]! - a[0]!) * f, a[1]! + (b[1]! - a[1]!) * f]);
      budget = 0;
      break;
    }
    if (part.length >= 2) out.push(part);
  });
  return out;
}
