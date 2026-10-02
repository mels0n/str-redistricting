import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DownloadError } from '../errors/index.js';

/**
 * Fetch `url` to `path` unless it is already there. The body is written to `path.part` and renamed
 * only once it is complete, so a partial download never looks like a cached file.
 */
export async function downloadCached(url: string, path: string, label: string): Promise<string> {
  if (existsSync(path)) return path;
  await mkdir(dirname(path), { recursive: true });
  const part = `${path}.part`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new DownloadError(`download failed for ${label}: HTTP ${res.status}`, res.status);
    const body = Buffer.from(await res.arrayBuffer());
    const expected = res.headers.get('content-length');
    if (expected !== null && Number(expected) !== body.length) {
      throw new DownloadError(`download for ${label} truncated: expected ${expected} bytes, got ${body.length}`);
    }
    await writeFile(part, body);
    await rename(part, path);
  } catch (err) {
    await rm(part, { force: true });
    throw err;
  }
  return path;
}
