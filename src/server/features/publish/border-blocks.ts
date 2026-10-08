import { VectorTile } from '@mapbox/vector-tile';
import type { Feature } from 'geojson';
import GeoJSONVT from 'geojson-vt';
import { PbfReader } from 'pbf';
import { fromGeojsonVt } from 'vt-pbf';
import { gzipSync } from 'node:zlib';
import { loadBlockPolygons, type Block } from '../../entities/census-block/index.js';
import type { StateInfo } from '../../shared/apportionment/index.js';
import { DataError } from '../../shared/errors/index.js';
import { crossesAntimeridian, unwrapCoordinates } from './antimeridian.js';
import { writePmtiles } from './pmtiles.js';
import { collection, deepOptions, DEEP_EXTENT, growBounds, MVT_VERSION, TILE_MAXZOOM } from './tiles.js';

/** The layer name inside blocks.pmtiles. */
export const BORDER_LAYER = 'blocks';
const MAX_MISSING_LISTED = 5;

const vertexKey = (p: readonly number[]): string => `${p[0]},${p[1]}`;

/**
 * GEOIDs of the blocks that share at least one vertex with a block of a different district, under any of the plans.
 * TIGER blocks share exact vertex coordinates, so a vertex that two districts meet at is enough: the blocks on both
 * sides of a district line, and blocks that only touch it at a corner. A vertex on the state edge has one side only
 * and never counts. Blocks are ordinary blocks here (water blocks included).
 */
export function borderGeoids(blocks: readonly Block[], plans: readonly ReadonlyMap<string, number>[]): Set<string> {
  const out = new Set<string>();
  for (const plan of plans) {
    const district = (b: Block): number => {
      const d = plan.get(b.geoid);
      if (d === undefined) throw new DataError(`block ${b.geoid} has no district in the plan`);
      return d;
    };
    const touch = new Map<string, number>(); // vertex -> district, or -1 where two districts meet
    for (const b of blocks) {
      const d = district(b);
      for (const ring of b.rings) {
        for (const p of ring) {
          const k = vertexKey(p);
          const seen = touch.get(k);
          if (seen === undefined) touch.set(k, d);
          else if (seen !== d) touch.set(k, -1);
        }
      }
    }
    for (const b of blocks) {
      if (b.rings.some((ring) => ring.some((p) => touch.get(vertexKey(p)) === -1))) out.add(b.geoid);
    }
  }
  return out;
}

export interface BorderBlockTiles {
  readonly bytes: Uint8Array;
  /** GEOIDs read back out of the encoded tiles, for verification. */
  readonly geoids: ReadonlySet<string>;
}

/**
 * blocks.pmtiles: the given blocks, whole, at TILE_MAXZOOM only (tolerance 0, same projection and extent as the deep
 * detail tiles so the edges line up with the district lines there). `finished` and `before` are 1-based districts.
 */
export function buildBorderBlockTiles(features: readonly Feature[], fingerprints: { finished: string; before: string }): BorderBlockTiles {
  const bounds: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const f of features) growBounds((f.geometry as { coordinates?: unknown }).coordinates, bounds);
  if (!Number.isFinite(bounds[0])) throw new DataError('Border block tiles need at least one block');

  const index = new GeoJSONVT(collection(features), deepOptions());
  const tiles = new Map<string, Uint8Array>();
  const geoids = new Set<string>();
  let frontier: [number, number][] = [[0, 0]];
  for (let z = 0; z <= TILE_MAXZOOM && frontier.length > 0; z++) {
    const next: [number, number][] = [];
    for (const [x, y] of frontier) {
      const tile = index.getTile(z, x, y);
      // A tile with no features is only the edge buffer of a neighbour; nothing to draw or store.
      if (!tile || tile.features.length === 0) continue;
      if (z === TILE_MAXZOOM) {
        const bytes = fromGeojsonVt({ [BORDER_LAYER]: tile }, { version: MVT_VERSION, extent: DEEP_EXTENT });
        const layer = new VectorTile(new PbfReader(bytes)).layers[BORDER_LAYER];
        for (let i = 0; layer && i < layer.length; i++) geoids.add(String(layer.feature(i).properties['geoid']));
        tiles.set(`${z}/${x}/${y}`, gzipSync(bytes));
      } else {
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) next.push([2 * x + dx, 2 * y + dy]);
      }
    }
    frontier = next;
  }
  if (tiles.size === 0) throw new DataError('Border block tiles came out empty');

  const bytes = writePmtiles(tiles, {
    minZoom: TILE_MAXZOOM,
    maxZoom: TILE_MAXZOOM,
    bounds,
    center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2, TILE_MAXZOOM],
    metadata: {
      name: 'blocks',
      fingerprints: { finished: fingerprints.finished, before: fingerprints.before },
      format: 'pbf',
      minzoom: TILE_MAXZOOM,
      maxzoom: TILE_MAXZOOM,
      vector_layers: [{ id: BORDER_LAYER, fields: { geoid: 'String', pop: 'Number', finished: 'Number', before: 'Number' } }],
    },
  });
  return { bytes, geoids };
}

/** Every border block must be in some tile; a block that fell out of the tiling is an error, not a gap in the map. */
export function verifyBorderBlocks(state: StateInfo, expected: ReadonlySet<string>, tiles: BorderBlockTiles): void {
  const missing = [...expected].filter((g) => !tiles.geoids.has(g));
  if (missing.length > 0) {
    throw new DataError(`${state.abbr}: ${missing.length} of ${expected.size} border blocks are missing from blocks.pmtiles; first ${MAX_MISSING_LISTED}: ${missing.slice(0, MAX_MISSING_LISTED).join(', ')}`);
  }
}

/**
 * The blocks.pmtiles of one state, built and verified. `allBlocks` supplies the vertices for selection; the shapes
 * themselves are re-read from the TIGER file so a block made of several polygons keeps its structure.
 * Null when no block sits on a district line (a one-district state).
 */
export async function buildStateBorderBlocks(
  state: StateInfo,
  cacheDir: string,
  allBlocks: readonly Block[],
  finished: ReadonlyMap<string, number>,
  before: ReadonlyMap<string, number>,
  fingerprints: { finished: string; before: string },
): Promise<Uint8Array | null> {
  const selected = borderGeoids(allBlocks, [finished, before]);
  // A state with one district has no district line, so no file at all.
  if (selected.size === 0) return null;
  const polygons = await loadBlockPolygons(state, cacheDir, selected);
  const wrapped = crossesAntimeridian(state.abbr);
  const features: Feature[] = [];
  for (const b of allBlocks) {
    if (!selected.has(b.geoid)) continue;
    const polys = polygons.get(b.geoid)!;
    const coordinates = wrapped ? unwrapCoordinates(polys) : polys;
    features.push({
      type: 'Feature',
      properties: { geoid: b.geoid, pop: b.pop, finished: finished.get(b.geoid)!, before: before.get(b.geoid)! },
      geometry: { type: 'MultiPolygon', coordinates } as Feature['geometry'],
    });
  }
  const tiles = buildBorderBlockTiles(features, fingerprints);
  verifyBorderBlocks(state, selected, tiles);
  return tiles.bytes;
}
