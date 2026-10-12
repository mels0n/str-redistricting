import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { PMTiles } from 'pmtiles';
import type { RangeResponse, Source } from 'pmtiles';
import type { Feature } from 'geojson';
import { describe, expect, it } from 'vitest';
import {
  DEEP_EXTENT,
  TILE_MAXZOOM,
  TILE_MINZOOM,
  DEEP_POINT_MARGIN,
  buildDetailTiles,
  deepSamplePoint,
  districtAtDeepTile,
  districtsAtDeepTile,
} from '../../../src/server/features/publish/tiles.js';

class BufferSource implements Source {
  constructor(private readonly bytes: Uint8Array) {}
  getKey(): string {
    return 'buffer';
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    const slice = this.bytes.slice(offset, offset + length);
    return { data: slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength) as ArrayBuffer };
  }
}

const COARSE = 4096;
const SPLIT = -104.9;
const M_LON = 1 / 85_500; // one metre of longitude at Denver, in degrees
const M_LAT = 1 / 111_200;
const LAT0 = 39.7;
const JAG = 200;

/** The shared edge from south to north: straight, then 200 vertices ~2 m apart that zigzag by 1.5 m, then straight. */
const shared: [number, number][] = [[SPLIT, 39.5], [SPLIT, LAT0]];
for (let i = 0; i < JAG; i++) shared.push([SPLIT + (i % 2 === 0 ? 0 : 1.5) * M_LON, LAT0 + (i + 1) * 2 * M_LAT]);
shared.push([SPLIT, 39.9]);
const jagVertices = shared.slice(2, 2 + JAG);

const poly = (district: number, ring: [number, number][]): Feature => ({
  type: 'Feature',
  properties: { district },
  geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]!]] },
});
const d1 = poly(1, [[-105.3, 39.5], ...shared, [-105.3, 39.9]]);
const d2 = poly(2, [[-104.5, 39.5], [-104.5, 39.9], ...[...shared].reverse()]);
const arc: Feature = { type: 'Feature', properties: { a: 1, b: 2 }, geometry: { type: 'LineString', coordinates: shared } };
const water: Feature = {
  type: 'Feature',
  properties: {},
  geometry: { type: 'Polygon', coordinates: [[[-105.1, 39.6], [-105.0, 39.6], [-105.0, 39.65], [-105.1, 39.65], [-105.1, 39.6]]] },
};
// The balanced plan's numbering is swapped relative to the finished one, so the two layers must answer differently at the same point.
const d1Before: Feature = { ...d1, properties: { district: 2 } };
const d2Before: Feature = { ...d2, properties: { district: 1 } };
const layers = { finished: [d1, d2], before: [d1Before, d2Before], 'finished-arcs': [arc], 'before-arcs': [arc], water: [water] };

const bytes = buildDetailTiles(layers, { finished: 'a'.repeat(64), before: 'b'.repeat(64) });

async function arcPoints(z: number, x: number, y: number, extent: number): Promise<string[]> {
  const got = await new PMTiles(new BufferSource(bytes)).getZxy(z, x, y);
  if (!got) return [];
  const layer = new VectorTile(new PbfReader(new Uint8Array(got.data))).layers['finished-arcs'];
  if (!layer) return [];
  const out: string[] = [];
  for (let i = 0; i < layer.length; i++) for (const ring of layer.feature(i).loadGeometry()) for (const p of ring) out.push(`${x * extent + p.x},${y * extent + p.y}`);
  return out;
}
const arcVertices = async (z: number, x: number, y: number): Promise<number> => (await arcPoints(z, x, y, COARSE)).length;

describe('buildDetailTiles', () => {
  it('declares zoom range, extent and every layer with its fields', async () => {
    expect(DEEP_EXTENT).toBeGreaterThan(4096);
    const reader = new PMTiles(new BufferSource(bytes));
    const header = await reader.getHeader();
    expect(header.minZoom).toBe(TILE_MINZOOM);
    expect(header.maxZoom).toBe(TILE_MAXZOOM);
    const meta = (await reader.getMetadata()) as { vector_layers: { id: string; fields: Record<string, string> }[] };
    expect(meta.vector_layers.map((l) => l.id)).toEqual(Object.keys(layers));
    expect(meta.vector_layers.find((l) => l.id === 'finished')!.fields).toEqual({ district: 'Number' });
    expect(meta.vector_layers.find((l) => l.id === 'finished-arcs')!.fields).toEqual({ a: 'Number', b: 'Number' });
    expect(header.minLon).toBeCloseTo(-105.3, 5);
    expect(header.maxLat).toBeCloseTo(39.9, 5);
  });

  it('keeps every jag vertex at the deepest zoom and simplifies the coarse zoom', async () => {
    const reader = new PMTiles(new BufferSource(bytes));
    const n = 1 << TILE_MAXZOOM;
    const tileX = (lon: number): number => Math.floor(((lon + 180) / 360) * n);
    const tileY = (lat: number): number => {
      const r = (lat * Math.PI) / 180;
      return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
    };
    const distinct = new Set<string>();
    for (let x = tileX(SPLIT) - 1; x <= tileX(SPLIT) + 1; x++) for (let y = tileY(39.9) - 1; y <= tileY(39.5) + 1; y++) {
      if (await reader.getZxy(TILE_MAXZOOM, x, y)) for (const k of await arcPoints(TILE_MAXZOOM, x, y, DEEP_EXTENT)) distinct.add(k);
    }
    // Buffer copies in neighbouring tiles dedupe to one global point each, so the jag keeps exactly its own vertices.
    const latOf = (key: string): number => {
      const gy = Number(key.split(',')[1]);
      return (Math.atan(Math.sinh(Math.PI * (1 - (2 * gy) / (n * DEEP_EXTENT)))) * 180) / Math.PI;
    };
    const inJag = [...distinct].filter((k) => latOf(k) > LAT0 + M_LAT && latOf(k) < LAT0 + (JAG * 2 + 1) * M_LAT);
    expect(inJag.length).toBe(JAG);
    const m = 1 << TILE_MINZOOM;
    let coarse = Infinity;
    for (let x = 0; x < m; x++) for (let y = 0; y < m; y++) {
      const v = await arcVertices(TILE_MINZOOM, x, y);
      if (v > 0) coarse = Math.min(coarse, v);
    }
    expect(coarse).toBeLessThan(JAG);
  }, 60_000);
});

describe('districtAtDeepTile', () => {
  const sample = (v: [number, number], side: number): [number, number] => [v[0] + side * 2 * M_LON, v[1]];

  it('puts points 2 m either side of a jag vertex in the right district', async () => {
    for (let i = 0; i < JAG; i += 7) {
      const v = jagVertices[i]!;
      expect(await districtAtDeepTile(bytes, 'finished', sample(v, -1))).toBe(1);
      expect(await districtAtDeepTile(bytes, 'finished', sample(v, 1))).toBe(2);
    }
    expect(await districtAtDeepTile(bytes, 'before', [-105.1, 39.8])).toBe(2);
  });

  it('answers the finished and before plans separately for the same point', async () => {
    const west: [number, number] = [-105.1, 39.8];
    const east: [number, number] = [-104.7, 39.6];
    expect(await districtAtDeepTile(bytes, 'finished', west)).toBe(1);
    expect(await districtAtDeepTile(bytes, 'before', west)).toBe(2);
    expect(await districtsAtDeepTile(bytes, 'finished', [west, east])).toEqual([1, 2]);
    expect(await districtsAtDeepTile(bytes, 'before', [west, east])).toEqual([2, 1]);
  });

  it('answers null outside the plan and in a batch matches the single form', async () => {
    expect(await districtAtDeepTile(bytes, 'finished', [-100, 30])).toBeNull();
    const pts: [number, number][] = [[-105.1, 39.8], [-104.7, 39.6], [-100, 30], sample(jagVertices[3]!, -1)];
    expect(await districtsAtDeepTile(bytes, 'finished', pts)).toEqual([1, 2, null, 1]);
  });
});

describe('deepSamplePoint', () => {
  // A border whose tile-unit x has fractional part .45, so it rounds down a whole 0.45 units at the deepest zoom.
  const units = 2 ** TILE_MAXZOOM * DEEP_EXTENT;
  const lonAt = (x: number): number => (x / units) * 360 - 180;
  const xOf = (lon: number): number => ((lon + 180) / 360) * units;
  const borderX = Math.floor(xOf(-104.9)) + 0.45;
  const border = lonAt(borderX);
  const d1 = poly(1, [[-105.3, 39.5], [border, 39.5], [border, 39.9], [-105.3, 39.9]]);
  const d2 = poly(2, [[border, 39.5], [-104.5, 39.5], [-104.5, 39.9], [border, 39.9]]);
  const tiles = buildDetailTiles({ finished: [d1, d2] }, { finished: 'a'.repeat(64), before: 'b'.repeat(64) });
  // A block of district 1 about 400 m wide whose east edge is the border, like a block the balancer moved across it.
  const west = lonAt(borderX - 800);
  const block = [[[west, 39.69], [border, 39.69], [border, 39.71], [west, 39.69 + 0.04 / 2], [west, 39.69]]];
  // Its Census interior point 0.3 tile units (about 0.12 m) inside the border, as FL block 120990059541000 had.
  const nearBorder: [number, number] = [lonAt(borderX - 0.3), 39.7];

  it('finds a block point the tiles can answer when the interior point is within rounding of a border', async () => {
    // The precision artifact itself: rounded onto the border, the point reads as the neighbouring district.
    expect(await districtAtDeepTile(tiles, 'finished', nearBorder)).toBe(2);
    const p = deepSamplePoint(block, nearBorder);
    expect(p).not.toBeNull();
    expect(borderX - xOf(p![0])).toBeGreaterThanOrEqual(DEEP_POINT_MARGIN);
    expect(await districtAtDeepTile(tiles, 'finished', p!)).toBe(1);
  });

  it('keeps an interior point that is well inside its block', () => {
    const inside: [number, number] = [lonAt(borderX - 400), 39.7];
    expect(deepSamplePoint(block, inside)).toEqual(inside);
  });

  it('gives up only on a block too thin to hold a point that far from its edges', () => {
    const sliver = [[[lonAt(borderX - 3), 39.69], [border, 39.69], [border, 39.71], [lonAt(borderX - 3), 39.71], [lonAt(borderX - 3), 39.69]]];
    expect(deepSamplePoint(sliver, [lonAt(borderX - 1.5), 39.7])).toBeNull();
    const narrow = [[[lonAt(borderX - 5), 39.69], [border, 39.69], [border, 39.71], [lonAt(borderX - 5), 39.71], [lonAt(borderX - 5), 39.69]]];
    expect(deepSamplePoint(narrow, [lonAt(borderX - 0.3), 39.7])).not.toBeNull();
  });
});
