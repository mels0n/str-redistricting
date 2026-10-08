import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { PMTiles } from 'pmtiles';
import type { RangeResponse, Source } from 'pmtiles';
import type { Feature } from 'geojson';
import { describe, expect, it } from 'vitest';
import type { Block } from '../../../src/server/entities/census-block/index.js';
import { borderGeoids, buildBorderBlockTiles, verifyBorderBlocks } from '../../../src/server/features/publish/border-blocks.js';
import { TILE_MAXZOOM } from '../../../src/server/features/publish/tiles.js';
import { DataError } from '../../../src/server/shared/errors/index.js';
import { stateByAbbr } from '../../../src/server/shared/apportionment/index.js';

const X0 = -105;
const Y0 = 40;
const STEP = 0.002;
const id = (c: number, r: number): string => `08001${String(c).padStart(5, '0')}${String(r).padStart(5, '0')}`;

/** An n by n grid of square blocks sharing exact corner coordinates, like TIGER. */
function grid(n: number): Block[] {
  const out: Block[] = [];
  for (let c = 0; c < n; c++) {
    for (let r = 0; r < n; r++) {
      // Corners come from integer indexes so neighbours get bit-identical coordinates.
      const [x0, x1, y0, y1] = [X0 + c * STEP, X0 + (c + 1) * STEP, Y0 + r * STEP, Y0 + (r + 1) * STEP];
      const [x, y] = [x0, y0];
      const ring: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
      out.push({ geoid: id(c, r), pop: c + r, point: [x + STEP / 2, y + STEP / 2], rings: [ring] });
    }
  }
  return out;
}
const plan = (blocks: readonly Block[], f: (c: number, r: number) => number): Map<string, number> =>
  new Map(blocks.map((b) => [b.geoid, f(Number(b.geoid.slice(5, 10)), Number(b.geoid.slice(10, 15)))]));

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

describe('borderGeoids', () => {
  const blocks = grid(5);

  it('keeps the blocks on both sides of a line and drops the interior and the state edge', () => {
    const got = borderGeoids(blocks, [plan(blocks, (c) => (c < 2 ? 1 : 2))]);
    const want = blocks.filter((b) => ['00001', '00002'].includes(b.geoid.slice(5, 10))).map((b) => b.geoid);
    expect([...got].sort()).toEqual(want.sort());
    expect(got.size).toBe(10);
  });

  it('counts a block that touches the line only at a corner', () => {
    const three = grid(3);
    const got = borderGeoids(three, [plan(three, (c, r) => (c === 2 && r === 2 ? 2 : 1))]);
    expect([...got].sort()).toEqual([id(1, 1), id(1, 2), id(2, 1), id(2, 2)]);
  });

  it('selects nothing when there is one district', () => {
    expect(borderGeoids(blocks, [plan(blocks, () => 1)]).size).toBe(0);
  });

  it('takes the union of the finished and the before-balancing plans', () => {
    const finished = plan(blocks, (c) => (c < 1 ? 1 : 2));
    const before = plan(blocks, (c) => (c < 4 ? 1 : 2));
    const got = borderGeoids(blocks, [finished, before]);
    const cols = new Set([...got].map((g) => g.slice(5, 10)));
    expect([...cols].sort()).toEqual(['00000', '00001', '00003', '00004']);
    expect(got.size).toBe(20);
  });

  it('gives the same answer when the vertices are split over several passes', () => {
    const big = grid(30);
    const p = plan(big, (c, r) => (c + r < 28 ? 1 : 2));
    const once = borderGeoids(big, [p]);
    expect(once.size).toBeGreaterThan(0);
    expect(borderGeoids(big, [p], 7)).toEqual(once);
  });

  it('rejects a block the plan does not cover', () => {
    expect(() => borderGeoids(blocks, [new Map()])).toThrow(DataError);
  });
});

describe('blocks.pmtiles', () => {
  const blocks = grid(4);
  const finished = plan(blocks, (c) => (c < 2 ? 1 : 2));
  const before = plan(blocks, (c) => (c < 1 ? 1 : 2));
  const selected = borderGeoids(blocks, [finished, before]);
  const features: Feature[] = blocks
    .filter((b) => selected.has(b.geoid))
    .map((b) => ({
      type: 'Feature',
      properties: { geoid: b.geoid, pop: b.pop, finished: finished.get(b.geoid)!, before: before.get(b.geoid)! },
      geometry: { type: 'MultiPolygon', coordinates: [b.rings.map((r) => r.map((p) => [p[0], p[1]]))] },
    }));
  const tiles = buildBorderBlockTiles(features, { finished: 'f'.repeat(64), before: 'b'.repeat(64) });

  it('holds one layer, blocks, at a single zoom, with the fingerprints in its metadata', async () => {
    const pm = new PMTiles(new BufferSource(tiles.bytes));
    const header = await pm.getHeader();
    expect([header.minZoom, header.maxZoom]).toEqual([TILE_MAXZOOM, TILE_MAXZOOM]);
    const meta = (await pm.getMetadata()) as { name: string; format: string; minzoom: number; maxzoom: number; fingerprints: Record<string, string>; vector_layers: { id: string; fields: Record<string, string> }[] };
    expect(meta.name).toBe('blocks');
    expect(meta.format).toBe('pbf');
    expect([meta.minzoom, meta.maxzoom]).toEqual([13, 13]);
    expect(meta.fingerprints).toEqual({ finished: 'f'.repeat(64), before: 'b'.repeat(64) });
    expect(meta.vector_layers).toEqual([{ id: 'blocks', fields: { geoid: 'String', pop: 'Number', finished: 'Number', before: 'Number' } }]);
  });

  it('carries geoid, pop, finished and before on every polygon, and every selected block is present', async () => {
    const pm = new PMTiles(new BufferSource(tiles.bytes));
    const seen = new Map<string, Record<string, unknown>>();
    // The grid is far smaller than a z13 tile, so it sits in one tile or a few neighbours.
    const x = Math.floor(((X0 + 180) / 360) * 2 ** TILE_MAXZOOM);
    const lat = (Y0 * Math.PI) / 180;
    const y = Math.floor(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * 2 ** TILE_MAXZOOM);
    for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]] as const) {
      const got = await pm.getZxy(TILE_MAXZOOM, x + dx, y + dy);
      if (!got) continue;
      const layer = new VectorTile(new PbfReader(new Uint8Array(got.data))).layers['blocks']!;
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        expect(f.type).toBe(3);
        seen.set(String(f.properties['geoid']), f.properties);
      }
    }
    expect([...seen.keys()].sort()).toEqual([...selected].sort());
    for (const [geoid, props] of seen) {
      expect(geoid).toMatch(/^\d{15}$/);
      expect(props).toEqual({ geoid, pop: expect.any(Number), finished: finished.get(geoid), before: before.get(geoid) });
    }
  });

  it('verification passes for the selection and fails when a block fell out', () => {
    const ri = stateByAbbr('RI')!;
    expect(() => verifyBorderBlocks(ri, selected, tiles)).not.toThrow();
    expect(() => verifyBorderBlocks(ri, new Set([...selected, id(99, 99)]), tiles)).toThrow(DataError);
  });
});
