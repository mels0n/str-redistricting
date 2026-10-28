import { feature } from 'topojson-client';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { z } from 'zod';
import { pointInGeometry, toStateFrame } from '../../shared/geo/index.js';

export interface ServerDistricts {
  usHouse: string | null;
  stateHouse: string | null;
  stateSenate: string | null;
}

export interface DistrictOptions {
  /** The site's own origin, where the published `/data/` files are served. */
  origin: string;
  fetchFn?: typeof fetch;
  now?: () => number;
}

const TTL_MS = 10 * 60_000;
const TopoSchema = z.looseObject({ type: z.literal('Topology'), objects: z.looseObject({ enacted: z.looseObject({}) }) });

type Shapes = Feature<Polygon | MultiPolygon, { code: string }>[];
const cache = new Map<string, { at: number; shapes: Promise<Shapes | null> }>();

/** Drops the cached files (tests). */
export function clearDistrictCache(): void {
  cache.clear();
}

async function load(url: string, fetchFn: typeof fetch): Promise<Shapes | null> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('districts file unavailable');
  const topo = TopoSchema.parse(await res.json()) as unknown as Topology<{ enacted: GeometryCollection<{ code: string }> }>;
  return (feature(topo, topo.objects.enacted) as unknown as { features: Shapes }).features;
}

function shapesFor(url: string, o: Required<DistrictOptions>): Promise<Shapes | null> {
  const hit = cache.get(url);
  if (hit && o.now() - hit.at < TTL_MS) return hit.shapes;
  const shapes = load(url, o.fetchFn);
  cache.set(url, { at: o.now(), shapes });
  shapes.catch(() => cache.delete(url));
  return shapes;
}

/** The lowest code among the districts containing the point, or null. */
function codeAt(shapes: Shapes | null, pt: [number, number]): string | null {
  if (!shapes) return null;
  const codes = shapes.filter((f) => pointInGeometry(pt, f.geometry)).map((f) => f.properties.code);
  codes.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  return codes[0] ?? null;
}

/** The enacted districts at a point, from the site's published files (each cached for 10 minutes per instance). */
export async function serverDistrictsAt(state: string, lonLat: [number, number], opts: DistrictOptions): Promise<ServerDistricts> {
  const o: Required<DistrictOptions> = { fetchFn: fetch, now: Date.now, ...opts };
  const pt = toStateFrame(state, lonLat) as [number, number];
  const base = `${o.origin}/data/${state}`;
  const [us, house, senate] = await Promise.all([
    shapesFor(`${base}/enacted.topo.json`, o),
    shapesFor(`${base}/state-house/enacted.topo.json`, o),
    shapesFor(`${base}/state-senate/enacted.topo.json`, o),
  ]);
  return { usHouse: codeAt(us, pt), stateHouse: codeAt(house, pt), stateSenate: codeAt(senate, pt) };
}
