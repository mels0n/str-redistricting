import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { DataError } from '../../shared/errors/index.js';

export type PmtilesMeta = {
  minZoom: number;
  maxZoom: number;
  bounds: [number, number, number, number];
  center: [number, number, number];
  metadata: Record<string, unknown>;
};

type Entry = { tileId: number; offset: number; length: number; runLength: number };

const HEADER_BYTES = 127;
const ROOT_BUDGET = 16384 - HEADER_BYTES;
const COMPRESSION_GZIP = 2;
const TILE_TYPE_MVT = 1;

/** Hilbert-curve tile id per the PMTiles v3 spec: zoom levels are laid out one after another. */
export function zxyToTileId(z: number, x: number, y: number): number {
  if (z > 26) throw new DataError(`PMTiles zoom ${z} exceeds 26`);
  const n = 2 ** z;
  if (x < 0 || y < 0 || x >= n || y >= n) throw new DataError(`PMTiles tile ${z}/${x}/${y} is out of range`);
  let acc = 0;
  for (let t = 0; t < z; t++) acc += 4 ** t;
  let tx = x;
  let ty = y;
  let d = 0;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (tx & s) > 0 ? 1 : 0;
    const ry = (ty & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        tx = n - 1 - tx;
        ty = n - 1 - ty;
      }
      [tx, ty] = [ty, tx];
    }
  }
  return acc + d;
}

function varint(out: number[], value: number): void {
  let v = value;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}

function serializeDirectory(entries: readonly Entry[]): Uint8Array {
  const out: number[] = [];
  varint(out, entries.length);
  let last = 0;
  for (const e of entries) {
    varint(out, e.tileId - last);
    last = e.tileId;
  }
  for (const e of entries) varint(out, e.runLength);
  for (const e of entries) varint(out, e.length);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    const prev = entries[i - 1];
    varint(out, i > 0 && prev && e.offset === prev.offset + prev.length ? 0 : e.offset + 1);
  }
  return gzipSync(Uint8Array.from(out));
}

function buildDirectories(entries: readonly Entry[]): { root: Uint8Array; leaves: Uint8Array } {
  const whole = serializeDirectory(entries);
  if (whole.length <= ROOT_BUDGET) return { root: whole, leaves: new Uint8Array(0) };
  for (let leafSize = 4096; ; leafSize *= 2) {
    const rootEntries: Entry[] = [];
    const leafChunks: Uint8Array[] = [];
    let leafBytes = 0;
    for (let i = 0; i < entries.length; i += leafSize) {
      const chunk = serializeDirectory(entries.slice(i, i + leafSize));
      rootEntries.push({ tileId: entries[i]!.tileId, offset: leafBytes, length: chunk.length, runLength: 0 });
      leafChunks.push(chunk);
      leafBytes += chunk.length;
    }
    const root = serializeDirectory(rootEntries);
    if (root.length <= ROOT_BUDGET || rootEntries.length === 1) {
      if (root.length > ROOT_BUDGET) throw new DataError('PMTiles root directory does not fit in 16 KiB');
      return { root, leaves: Buffer.concat(leafChunks) };
    }
  }
}

function e7(degrees: number): number {
  return Math.round(degrees * 1e7);
}

/** Serialises already-gzipped MVT tiles (keyed "z/x/y") into one PMTiles v3 archive. */
export function writePmtiles(tiles: ReadonlyMap<string, Uint8Array>, meta: PmtilesMeta): Uint8Array {
  if (tiles.size === 0) throw new DataError('PMTiles archive needs at least one tile');
  const keyed: { tileId: number; data: Uint8Array }[] = [];
  for (const [key, data] of tiles) {
    const parts = key.split('/').map(Number);
    const [z, x, y] = parts;
    if (parts.length !== 3 || !Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) throw new DataError(`Bad PMTiles tile key "${key}"`);
    keyed.push({ tileId: zxyToTileId(z!, x!, y!), data });
  }
  keyed.sort((a, b) => a.tileId - b.tileId);

  const placed = new Map<string, { offset: number; length: number }>();
  const chunks: Uint8Array[] = [];
  let dataBytes = 0;
  const entries: Entry[] = [];
  for (const { tileId, data } of keyed) {
    const hash = createHash('sha256').update(data).digest('hex');
    let spot = placed.get(hash);
    if (!spot) {
      spot = { offset: dataBytes, length: data.length };
      placed.set(hash, spot);
      chunks.push(data);
      dataBytes += data.length;
    }
    const last = entries[entries.length - 1];
    if (last && last.offset === spot.offset && last.length === spot.length && tileId === last.tileId + last.runLength) last.runLength++;
    else entries.push({ tileId, offset: spot.offset, length: spot.length, runLength: 1 });
  }

  const { root, leaves } = buildDirectories(entries);
  const metadata = gzipSync(Buffer.from(JSON.stringify(meta.metadata)));
  const rootOffset = HEADER_BYTES;
  const metadataOffset = rootOffset + root.length;
  const leafOffset = metadataOffset + metadata.length;
  const dataOffset = leafOffset + leaves.length;

  const header = Buffer.alloc(HEADER_BYTES);
  header.write('PMTiles', 0, 'latin1');
  header.writeUInt8(3, 7);
  const u64 = (pos: number, value: number): void => void header.writeBigUInt64LE(BigInt(value), pos);
  u64(8, rootOffset);
  u64(16, root.length);
  u64(24, metadataOffset);
  u64(32, metadata.length);
  u64(40, leafOffset);
  u64(48, leaves.length);
  u64(56, dataOffset);
  u64(64, dataBytes);
  u64(72, keyed.length);
  u64(80, entries.length);
  u64(88, placed.size);
  header.writeUInt8(1, 96);
  header.writeUInt8(COMPRESSION_GZIP, 97);
  header.writeUInt8(COMPRESSION_GZIP, 98);
  header.writeUInt8(TILE_TYPE_MVT, 99);
  header.writeUInt8(meta.minZoom, 100);
  header.writeUInt8(meta.maxZoom, 101);
  header.writeInt32LE(e7(meta.bounds[0]), 102);
  header.writeInt32LE(e7(meta.bounds[1]), 106);
  header.writeInt32LE(e7(meta.bounds[2]), 110);
  header.writeInt32LE(e7(meta.bounds[3]), 114);
  header.writeUInt8(meta.center[2], 118);
  header.writeInt32LE(e7(meta.center[0]), 119);
  header.writeInt32LE(e7(meta.center[1]), 123);

  return Buffer.concat([header, root, metadata, leaves, ...chunks]);
}
