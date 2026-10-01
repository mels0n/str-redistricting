import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadStateBlocks } from '../../../src/server/features/census/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';

const state = { abbr: 'RI', fips: '44', name: 'Rhode Island', seats: 2 };
let dir: string;
const zipPath = () => join(dir, 'tl_2020_44_tabblock20.zip');

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'census-dl-'));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

describe('census download cache', () => {
  it('rejects a body that disagrees with content-length and leaves no files', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('abc', { status: 200, headers: { 'content-length': '10' } })));
    await expect(loadStateBlocks(state, dir)).rejects.toThrow(DataError);
    expect(existsSync(zipPath())).toBe(false);
    expect(existsSync(`${zipPath()}.part`)).toBe(false);
  });
  it('rejects HTTP 500 and leaves no final file', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 500 })));
    await expect(loadStateBlocks(state, dir)).rejects.toThrow(DataError);
    expect(existsSync(zipPath())).toBe(false);
  });
  it('ignores a leftover .part file and fetches', async () => {
    await writeFile(`${zipPath()}.part`, 'garbage');
    const f = vi.fn(async () => new Response('x', { status: 500 }));
    vi.stubGlobal('fetch', f);
    await expect(loadStateBlocks(state, dir)).rejects.toThrow(DataError);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
