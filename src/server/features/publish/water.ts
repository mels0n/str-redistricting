import mapshaper from 'mapshaper';
import { DataError } from '../../shared/errors/index.js';

/** The district area is grown by this much before the land is taken away, so the mask never stops short of a district's edge. */
const OUTWARD_M = 300;
/** Detached pieces smaller than this are slivers where two outlines of the same shore disagree, not water. */
export const MIN_PIECE = '0.5km2';

const text = (body: string | Uint8Array | undefined, what: string): string => {
  if (body === undefined) throw new DataError(`mapshaper produced no output for ${what}`);
  return typeof body === 'string' ? body : Buffer.from(body).toString('utf8');
};

interface Collection {
  readonly type: string;
  readonly geometries?: readonly unknown[];
  readonly features?: readonly { readonly geometry: unknown }[];
}

/** Every land outline merged into one layer (GeoJSON text), made once and reused for each state. */
export async function mergeLand(geometries: readonly unknown[]): Promise<string> {
  const fc = { type: 'FeatureCollection', features: geometries.map((geometry) => ({ type: 'Feature', properties: {}, geometry })) };
  const out = await mapshaper.applyCommands('-i land.json -dissolve -o out.json format=geojson', { 'land.json': JSON.stringify(fc) });
  return text(out['out.json'], 'land');
}

/**
 * The water inside a state's districts: the area the districts cover, less the land. The districts are drawn
 * from census blocks, which run out to the legal boundary, so they cover lakes, bays and coastal water.
 * The mask is for display only; it never feeds the generator or any number.
 * `districts` and `land` are GeoJSON text; the result is a FeatureCollection of the water polygons.
 */
export async function buildWater(districts: string, land: string): Promise<{ type: 'FeatureCollection'; features: { type: 'Feature'; properties: Record<string, never>; geometry: { coordinates?: unknown } }[] }> {
  const cmd =
    '-i land.json districts.json combine-files ' +
    '-dissolve target=districts ' +
    `-buffer radius=${OUTWARD_M} target=districts ` +
    '-erase target=districts source=land ' +
    `-filter-islands min-area=${MIN_PIECE} remove-empty target=districts ` +
    '-o target=districts out.json format=geojson';
  const out = await mapshaper.applyCommands(cmd, { 'land.json': land, 'districts.json': districts });
  const body = JSON.parse(text(out['out.json'], 'water')) as Collection;
  const geometries = (body.geometries ?? body.features?.map((f) => f.geometry) ?? []) as { type: string; coordinates?: unknown }[];
  return {
    type: 'FeatureCollection',
    features: geometries.filter((g) => g.coordinates !== undefined).map((geometry) => ({ type: 'Feature', properties: {}, geometry })),
  };
}

/** A block with people in it: the 1-based district it belongs to and its internal point (lon, lat). */
export interface PopulatedPoint {
  readonly district: number;
  readonly point: readonly [number, number];
}

type Ring = readonly (readonly number[])[];
interface Part {
  readonly rings: readonly Ring[];
  readonly bbox: readonly [number, number, number, number];
  hit: boolean;
}

function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = [ring[i]![0]!, ring[i]![1]!];
    const [xj, yj] = [ring[j]![0]!, ring[j]![1]!];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function toPart(rings: readonly Ring[]): Part {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of rings[0] ?? []) {
    if (x! < x0) x0 = x!;
    if (x! > x1) x1 = x!;
    if (y! < y0) y0 = y!;
    if (y! > y1) y1 = y!;
  }
  return { rings, bbox: [x0, y0, x1, y1], hit: false };
}

const inPart = (p: Part, x: number, y: number): boolean =>
  x >= p.bbox[0] && x <= p.bbox[2] && y >= p.bbox[1] && y <= p.bbox[3] && inRing(x, y, p.rings[0]!) && !p.rings.slice(1).some((h) => inRing(x, y, h));

/**
 * How many separate pieces of land each district has that people live on: the district area clipped to the
 * shoreline-clipped land (no size threshold), split into its pieces, counting the pieces that contain the internal
 * point of at least one populated block of the district. `districts` is a GeoJSON FeatureCollection (text) whose
 * features carry a 1-based `district` property; `land` is the merged land layer; `populated` lists the blocks with
 * people under this plan. Result is indexed by district - 1. A district with people always has at least 1: when
 * none of its populated points fall on the clipped land (the outlines disagree), it is counted as 1 and listed in `clamped`.
 * Display only: it never feeds the generator or any number.
 */
export async function countLandParts(districts: string, land: string, seats: number, populated: readonly PopulatedPoint[]): Promise<{ parts: number[]; clamped: number }> {
  const out = await mapshaper.applyCommands('-i land.json districts.json combine-files -clip target=districts source=land -o target=districts out.json format=geojson', { 'land.json': land, 'districts.json': districts });
  const body = JSON.parse(text(out['out.json'], 'land parts')) as { features?: { properties?: { district?: number }; geometry?: { type: string; coordinates?: unknown[] } | null }[] };
  const pieces: Part[][] = Array.from({ length: seats }, () => []);
  for (const f of body.features ?? []) {
    const d = f.properties?.district;
    if (d === undefined || d < 1 || d > seats) continue;
    const g = f.geometry;
    if (g?.coordinates === undefined) continue;
    const polys = g.type === 'MultiPolygon' ? (g.coordinates as Ring[][]) : g.type === 'Polygon' ? [g.coordinates as Ring[]] : [];
    for (const rings of polys) if (rings.length > 0) pieces[d - 1]!.push(toPart(rings));
  }
  const populatedIn = new Array<boolean>(seats).fill(false);
  for (const p of populated) {
    if (p.district < 1 || p.district > seats) continue;
    populatedIn[p.district - 1] = true;
    for (const part of pieces[p.district - 1]!) {
      if (part.hit || !inPart(part, p.point[0], p.point[1])) continue;
      part.hit = true;
      break;
    }
  }
  let clamped = 0;
  const parts = pieces.map((ps, i) => {
    const n = ps.filter((x) => x.hit).length;
    if (n === 0 && populatedIn[i]) clamped++;
    return Math.max(1, n);
  });
  return { parts, clamped };
}
