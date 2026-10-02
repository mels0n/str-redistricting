import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8');

/** The `/*` block of public/_headers as a name to value map. */
function headersFile(): Map<string, string> {
  const out = new Map<string, string>();
  let inAll = false;
  for (const raw of read('public/_headers').split(/\r?\n/)) {
    if (raw.startsWith('#') || raw.trim() === '') { if (raw.trim() === '' && inAll && out.size > 0) break; continue; }
    if (!raw.startsWith(' ')) { inAll = raw.trim() === '/*'; continue; }
    if (!inAll) continue;
    const i = raw.indexOf(':');
    out.set(raw.slice(0, i).trim(), raw.slice(i + 1).trim());
  }
  return out;
}

describe('deploy configuration', () => {
  const vercel = JSON.parse(read('vercel.json')) as { installCommand: string; headers: { source: string; headers: { key: string; value: string }[] }[] };

  it('installs from the lockfile', () => {
    expect(vercel.installCommand).toBe('npm ci');
  });
  it('sends the same security headers from vercel.json as public/_headers', () => {
    const fromVercel = new Map(vercel.headers.find((h) => h.source === '/(.*)')!.headers.map((h) => [h.key, h.value]));
    const fromFile = headersFile();
    expect(fromFile.size).toBeGreaterThanOrEqual(4);
    expect(Object.fromEntries(fromVercel)).toEqual(Object.fromEntries(fromFile));
  });
  it('keeps unsafe-inline and unsafe-eval out of the policy', () => {
    expect(headersFile().get('Content-Security-Policy')).not.toMatch(/unsafe-/);
  });
});
