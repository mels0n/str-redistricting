import mapshaper from 'mapshaper';
import { DataError } from '../../shared/errors/index.js';

/** The district area is grown by this much before the land is taken away, so the mask never stops short of a district's edge. */
const OUTWARD_M = 300;
/** Detached pieces smaller than this are slivers where two outlines of the same shore disagree, not water. */
const MIN_PIECE = '0.5km2';

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
