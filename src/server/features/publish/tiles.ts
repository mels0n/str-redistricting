import { VectorTile } from '@mapbox/vector-tile';
import type { Feature, FeatureCollection } from 'geojson';
import GeoJSONVT from 'geojson-vt';
import type { Options } from 'geojson-vt';
import { PbfReader } from 'pbf';
import { PMTiles } from 'pmtiles';
import type { RangeResponse, Source } from 'pmtiles';
import { fromGeojsonVt } from 'vt-pbf';
import { gzipSync } from 'node:zlib';
import { DataError } from '../../shared/errors/index.js';
import { writePmtiles } from './pmtiles.js';

/** First and last zoom of the detail tiles. The map draws them only when zoomed in. */
export const TILE_MINZOOM = 7;
export const TILE_MAXZOOM = 13;
/** Tile extent at TILE_MAXZOOM: 8192 units over a ~4.9 km tile is about 0.45 m at 40N. */
export const DEEP_EXTENT = 8192;
const COARSE_EXTENT = 4096;
const MVT_VERSION = 2;

type Layers = Readonly<Record<string, readonly Feature[]>>;

/** Zooms below TILE_MAXZOOM: ordinary simplification, extent 4096. */
const coarseOptions = (): Options => ({ maxZoom: TILE_MAXZOOM - 1, extent: COARSE_EXTENT });
/** TILE_MAXZOOM: tolerance 0 keeps every vertex. Point sampling uses the same options so it projects identically. */
const deepOptions = (): Options => ({ maxZoom: TILE_MAXZOOM, indexMaxZoom: TILE_MAXZOOM, extent: DEEP_EXTENT, buffer: 128, tolerance: 0 });

const collection = (features: readonly Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features: [...features] });

function growBounds(node: unknown, b: [number, number, number, number]): void {
  if (!Array.isArray(node)) return;
  if (typeof node[0] === 'number' && typeof node[1] === 'number') {
    b[0] = Math.min(b[0], node[0]);
    b[1] = Math.min(b[1], node[1]);
    b[2] = Math.max(b[2], node[0]);
    b[3] = Math.max(b[3], node[1]);
    return;
  }
  for (const child of node) growBounds(child, b);
}

function layerFields(features: readonly Feature[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const f of features) {
    for (const [key, value] of Object.entries(f.properties ?? {})) {
      if (key in fields || value === null || value === undefined) continue;
      fields[key] = typeof value === 'number' ? 'Number' : typeof value === 'boolean' ? 'Boolean' : 'String';
    }
  }
  return fields;
}

/**
 * Encode every layer of one state as a single `.pmtiles`. Zooms TILE_MINZOOM..TILE_MAXZOOM-1 come from a
 * simplified index; TILE_MAXZOOM comes from a tolerance-0 index at a finer extent so borders are block-exact.
 * Tiles are found by walking the geojson-vt tile tree from 0/0/0 (a tile exists only if it has features).
 */
export function buildDetailTiles(layers: Layers, fingerprints: { finished: string; before: string }): Uint8Array {
  const names = Object.keys(layers);
  const bounds: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const name of names) for (const f of layers[name]!) growBounds((f.geometry as { coordinates?: unknown } | null)?.coordinates, bounds);
  if (!Number.isFinite(bounds[0])) throw new DataError('Detail tiles need at least one feature');

  const coarse = names.map((n) => new GeoJSONVT(collection(layers[n]!), coarseOptions()));
  const deep = names.map((n) => new GeoJSONVT(collection(layers[n]!), deepOptions()));
  const indexes = (z: number): GeoJSONVT[] => (z === TILE_MAXZOOM ? deep : coarse);

  const tiles = new Map<string, Uint8Array>();
  let frontier: [number, number][] = [[0, 0]];
  for (let z = 0; z <= TILE_MAXZOOM && frontier.length > 0; z++) {
    const idx = indexes(z);
    const next: [number, number][] = [];
    for (const [x, y] of frontier) {
      const present: Record<string, { features: unknown[] }> = {};
      idx.forEach((index, i) => {
        const tile = index.getTile(z, x, y);
        if (tile) present[names[i]!] = tile;
      });
      if (Object.keys(present).length === 0) continue;
      if (z >= TILE_MINZOOM) {
        const bytes = fromGeojsonVt(present, { version: MVT_VERSION, extent: z === TILE_MAXZOOM ? DEEP_EXTENT : COARSE_EXTENT });
        tiles.set(`${z}/${x}/${y}`, gzipSync(bytes));
      }
      if (z < TILE_MAXZOOM) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) next.push([2 * x + dx, 2 * y + dy]);
    }
    frontier = next;
  }
  if (tiles.size === 0) throw new DataError('Detail tiles came out empty');

  return writePmtiles(tiles, {
    minZoom: TILE_MINZOOM,
    maxZoom: TILE_MAXZOOM,
    bounds,
    center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2, TILE_MINZOOM],
    metadata: {
      name: 'detail',
      fingerprints: { finished: fingerprints.finished, before: fingerprints.before },
      format: 'pbf',
      minzoom: TILE_MINZOOM,
      maxzoom: TILE_MAXZOOM,
      vector_layers: names.map((id) => ({ id, fields: layerFields(layers[id]!) })),
    },
  });
}

class BufferSource implements Source {
  constructor(private readonly bytes: Uint8Array) {}
  getKey(): string {
    return 'detail';
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const slice = this.bytes.slice(offset, offset + length);
    return { data: slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) as ArrayBuffer };
  }
}

interface DecodedPolygon {
  readonly district: number | null;
  readonly rings: readonly (readonly { x: number; y: number }[])[];
}

interface Reader {
  readonly pmtiles: PMTiles;
  readonly decoded: Map<string, Promise<readonly DecodedPolygon[] | null>>;
}

/** One reader and one decoded-tile cache per pmtiles byte array, so a batch of lookups decodes each tile once. */
const readers = new WeakMap<Uint8Array, Reader>();

function readerFor(bytes: Uint8Array): Reader {
  let r = readers.get(bytes);
  if (!r) {
    r = { pmtiles: new PMTiles(new BufferSource(bytes)), decoded: new Map() };
    readers.set(bytes, r);
  }
  return r;
}

function decodeTile(reader: Reader, layer: string, z: number, x: number, y: number): Promise<readonly DecodedPolygon[] | null> {
  const key = `${layer}/${z}/${x}/${y}`;
  let cached = reader.decoded.get(key);
  if (!cached) {
    cached = (async () => {
      const got = await reader.pmtiles.getZxy(z, x, y);
      if (!got) return null;
      const vl = new VectorTile(new PbfReader(new Uint8Array(got.data))).layers[layer];
      if (!vl) return null;
      const out: DecodedPolygon[] = [];
      for (let i = 0; i < vl.length; i++) {
        const f = vl.feature(i);
        if (f.type !== 3) continue;
        const district = f.properties['district'];
        out.push({ district: typeof district === 'number' ? district : null, rings: f.loadGeometry() });
      }
      return out;
    })();
    reader.decoded.set(key, cached);
  }
  return cached;
}

/** Even-odd test over all rings of one polygon feature (holes fall out of the parity). */
function inside(rings: DecodedPolygon['rings'], px: number, py: number): boolean {
  let odd = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!;
      const b = ring[j]!;
      if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) odd = !odd;
    }
  }
  return odd;
}

/**
 * The district of the polygon layer at each point, read from the TILE_MAXZOOM tiles of a `.pmtiles`, or null
 * where no polygon covers the point. Points are projected by indexing them with geojson-vt under the deep
 * index's own options, so the projection is the one the tiles were cut with. Used by publish verification and tests.
 */
export async function districtsAtDeepTile(pmtiles: Uint8Array, layer: string, points: readonly [number, number][]): Promise<(number | null)[]> {
  const result: (number | null)[] = points.map(() => null);
  if (points.length === 0) return result;
  const projector = new GeoJSONVT(
    collection(points.map((p, i) => ({ type: 'Feature', properties: { i }, geometry: { type: 'Point', coordinates: [p[0], p[1]] } }))),
    { ...deepOptions(), indexMaxPoints: 0 },
  );
  const where: ({ x: number; y: number; px: number; py: number } | undefined)[] = points.map(() => undefined);
  for (const c of projector.tileCoords) {
    if (c.z !== TILE_MAXZOOM) continue;
    const tile = projector.getTile(c.z, c.x, c.y);
    for (const f of tile?.features ?? []) {
      if (f.type !== 1) continue;
      const i = f.tags?.['i'];
      const g = f.geometry[0];
      if (typeof i !== 'number' || !g) continue;
      // Buffer copies of the point in neighbouring tiles fall outside the extent and are skipped.
      if (g[0] >= 0 && g[0] < DEEP_EXTENT && g[1] >= 0 && g[1] < DEEP_EXTENT) where[i] = { x: c.x, y: c.y, px: g[0], py: g[1] };
    }
  }
  const reader = readerFor(pmtiles);
  for (let i = 0; i < points.length; i++) {
    const w = where[i];
    if (!w) continue;
    const polys = await decodeTile(reader, layer, TILE_MAXZOOM, w.x, w.y);
    const hit = polys?.find((p) => inside(p.rings, w.px, w.py));
    result[i] = hit?.district ?? null;
  }
  return result;
}

export async function districtAtDeepTile(pmtiles: Uint8Array, layer: string, lonLat: [number, number]): Promise<number | null> {
  return (await districtsAtDeepTile(pmtiles, layer, [lonLat]))[0] ?? null;
}
