import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readBoundaryZip } from '../../../../src/server/features/publish/index.js';

/** A shapefile holding `count` null shapes (the geometry is not under test). */
function shp(count: number): Buffer {
  const b = Buffer.alloc(100 + count * 12);
  b.writeInt32BE(9994, 0);
  b.writeInt32BE(b.length / 2, 24);
  b.writeInt32LE(1000, 28);
  b.writeInt32LE(0, 32);
  for (let i = 0; i < count; i++) {
    b.writeInt32BE(i + 1, 100 + i * 12);
    b.writeInt32BE(2, 104 + i * 12);
    b.writeInt32LE(0, 108 + i * 12);
  }
  return b;
}

/** A DBF with one 40-byte text field, NAME, whose values are written as UTF-8 (as the Census Bureau does). */
function dbf(names: string[]): Buffer {
  const width = 40;
  const header = 32 + 32 + 1;
  const recLen = 1 + width;
  const b = Buffer.alloc(header + names.length * recLen + 1, 0x20);
  b.fill(0, 0, header);
  b.writeUInt8(3, 0);
  b.writeUInt32LE(names.length, 4);
  b.writeUInt16LE(header, 8);
  b.writeUInt16LE(recLen, 10);
  b.write('NAME', 32, 'ascii');
  b.write('C', 43, 'ascii');
  b.writeUInt8(width, 48);
  b.writeUInt8(0x0d, 64);
  names.forEach((n, i) => {
    const at = header + i * recLen;
    b.fill(0x20, at, at + recLen);
    b.write(n, at + 1, 'utf-8');
  });
  b.writeUInt8(0x1a, b.length - 1);
  return b;
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'boundary-utf8-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('readBoundaryZip', () => {
  it('reads Census attribute text as UTF-8, so accented names keep their letters', async () => {
    const names = ['Doña Ana', 'Plain'];
    const zip = new AdmZip();
    zip.addFile('cb_test.shp', shp(names.length));
    zip.addFile('cb_test.dbf', dbf(names));
    const path = join(dir, 'cb_test.zip');
    writeFileSync(path, zip.toBuffer());
    const rows = await readBoundaryZip(path, 'cb_test');
    expect(rows.map((r) => (r.properties as { NAME: string }).NAME)).toEqual(names);
  });
});
