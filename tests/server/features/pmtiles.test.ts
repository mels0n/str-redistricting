import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { PMTiles, zxyToTileId as referenceTileId } from 'pmtiles';
import type { RangeResponse, Source } from 'pmtiles';
import { describe, expect, it } from 'vitest';
import { writePmtiles, zxyToTileId } from '../../../src/server/features/publish/pmtiles.js';
import type { PmtilesMeta } from '../../../src/server/features/publish/pmtiles.js';

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

const meta: PmtilesMeta = {
  minZoom: 0,
  maxZoom: 12,
  bounds: [-80, 30, -70, 40],
  center: [-75, 35, 4],
  metadata: { name: 'detail', vector_layers: [{ id: 'districts', fields: { id: 'String' } }] },
};

describe('zxyToTileId', () => {
  it('matches the PMTiles v3 Hilbert ordering and the reference package', () => {
    expect(zxyToTileId(0, 0, 0)).toBe(0);
    expect(zxyToTileId(1, 0, 0)).toBe(1);
    expect(zxyToTileId(1, 0, 1)).toBe(2);
    expect(zxyToTileId(1, 1, 1)).toBe(3);
    expect(zxyToTileId(1, 1, 0)).toBe(4);
    expect(zxyToTileId(2, 0, 0)).toBe(5);
    for (const [z, x, y] of [[3, 5, 2], [7, 100, 27], [12, 1234, 3210], [14, 16383, 0]] as const) {
      expect(zxyToTileId(z, x, y)).toBe(referenceTileId(z, x, y));
    }
  });
});

describe('writePmtiles', () => {
  it('round-trips tiles, dedupes identical content and keeps metadata', async () => {
    const a = gzipSync(Buffer.from('tile-a'));
    const b = gzipSync(Buffer.from('tile-b'));
    const tiles = new Map<string, Uint8Array>([['0/0/0', a], ['1/1/0', b], ['1/0/1', a]]);
    const reader = new PMTiles(new BufferSource(writePmtiles(tiles, meta)));
    const header = await reader.getHeader();
    expect(header.tileType).toBe(1);
    expect(header.tileCompression).toBe(2);
    expect(header.minZoom).toBe(0);
    expect(header.maxZoom).toBe(12);
    expect(header.numAddressedTiles).toBe(3);
    expect(header.numTileContents).toBe(2);
    expect(header.clustered).toBe(true);
    for (const [key, bytes] of tiles) {
      const [z, x, y] = key.split('/').map(Number) as [number, number, number];
      const got = await reader.getZxy(z, x, y);
      expect(Buffer.from(got!.data)).toEqual(Buffer.from(gunzipSync(bytes)));
    }
    expect(await reader.getZxy(1, 0, 0)).toBeUndefined();
    expect(await reader.getMetadata()).toEqual(meta.metadata);
  });

  it('splits into leaf directories for a root that exceeds 16 KiB', async () => {
    const tiles = new Map<string, Uint8Array>();
    for (let i = 0; i < 12000; i++) tiles.set(`14/${(i * 10007) % 16384}/${(i * 6151 + 7 * Math.floor(i / 16384)) % 16384}`, gzipSync(Buffer.concat(Array.from({ length: 1 + ((i * 7919) % 12) }, (_, k) => createHash('sha256').update(`${i}:${k}`).digest()))));
    const reader = new PMTiles(new BufferSource(writePmtiles(tiles, { ...meta, minZoom: 14, maxZoom: 14 })));
    const header = await reader.getHeader();
    expect(tiles.size).toBe(12000);
    expect(header.numAddressedTiles).toBe(12000);
    expect(header.leafDirectoryLength).toBeGreaterThan(0);
    for (const [key, bytes] of tiles) {
      const [z, x, y] = key.split('/').map(Number) as [number, number, number];
      const got = await reader.getZxy(z, x, y);
      expect(Buffer.from(got!.data)).toEqual(Buffer.from(gunzipSync(bytes)));
    }
  });
});
