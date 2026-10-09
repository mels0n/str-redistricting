import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8');

/** The `/*` block of public/_headers as a name to value map. */
function headersFile(block = '/*'): Map<string, string> {
  const out = new Map<string, string>();
  let inAll = false;
  for (const raw of read('public/_headers').split(/\r?\n/)) {
    if (raw.startsWith('#') || raw.trim() === '') { if (raw.trim() === '' && inAll && out.size > 0) break; continue; }
    if (!raw.startsWith(' ')) { inAll = raw.trim() === block; continue; }
    if (!inAll) continue;
    const i = raw.indexOf(':');
    out.set(raw.slice(0, i).trim(), raw.slice(i + 1).trim());
  }
  return out;
}

describe('deploy configuration', () => {
  const vercel = JSON.parse(read('vercel.json')) as { installCommand: string; headers: { source: string; headers: { key: string; value: string }[] }[] };

  it('installs from the lockfile', () => {
    expect(vercel.installCommand).toBe('npm ci --ignore-scripts');
  });
  it('sends the same security headers from vercel.json as public/_headers', () => {
    const fromVercel = new Map(vercel.headers.find((h) => h.source === '/(.*)')!.headers.map((h) => [h.key, h.value]));
    const fromFile = headersFile();
    expect(fromFile.size).toBeGreaterThanOrEqual(4);
    expect(Object.fromEntries(fromVercel)).toEqual(Object.fromEntries(fromFile));
  });
  it('revalidates map data on every load, in both files, while hashed assets stay immutable', () => {
    const cache = (source: string): string | undefined => vercel.headers.find((h) => h.source === source)?.headers.find((h) => h.key === 'Cache-Control')?.value;
    expect(cache('/data/(.*)')).toBe('public, max-age=0, must-revalidate');
    expect(headersFile('/data/*').get('Cache-Control')).toBe(cache('/data/(.*)'));
    expect(cache('/assets/(.*)')).toBe('public, max-age=31536000, immutable');
    expect(headersFile('/assets/*').get('Cache-Control')).toBe(cache('/assets/(.*)'));
    // The two rules cover disjoint paths, so neither can override the other.
    expect(vercel.headers.filter((h) => h.headers.some((x) => x.key === 'Cache-Control')).map((h) => h.source)).toEqual(['/assets/(.*)', '/data/(.*)']);
  });
  it('keeps unsafe-inline and unsafe-eval out of the policy', () => {
    expect(headersFile().get('Content-Security-Policy')).not.toMatch(/unsafe-/);
  });
});
