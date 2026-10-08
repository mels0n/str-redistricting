import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnactedFile } from '../../../src/server/features/publish/boundary.js';
import { downloadForPinning } from '../../../src/server/shared/http/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';

vi.mock('../../../src/server/features/publish/boundary.js', async (orig) => ({
  ...(await orig<typeof import('../../../src/server/features/publish/boundary.js')>()),
  loadEnacted: vi.fn(),
}));

const { loadEnacted } = await import('../../../src/server/features/publish/boundary.js');
const { publishEnactedOnly } = await import('../../../src/server/features/publish/index.js');
const { parsePublishConfig } = await import('../../../src/server/shared/config/index.js');

const square = (x: number, y: number) => ({ type: 'Polygon', coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]] });
const district = (fp: string, code: string, x: number): EnactedFile['features'][number] => ({
  record: { stateFp: fp, label: `Congressional District ${Number(code)}`, code }, geometry: square(x, 40),
});
const file = (source: string): EnactedFile => ({
  source,
  // Rhode Island (44, two seats) and Delaware (10, one seat); Alaska (02) is left out on purpose.
  features: [district('44', '02', -72), district('44', '01', -73), district('10', '00', -75)],
});

let dir: string;
const put = (st: string, name: string, body: string): void => {
  mkdirSync(join(dir, st), { recursive: true });
  writeFileSync(join(dir, st, name), body);
};
const get = (st: string, name: string): string => readFileSync(join(dir, st, name), 'utf8');
const snapshot = (): Record<string, string> =>
  Object.fromEntries(readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((p) => p.endsWith('.json')).sort().map((p) => [p, readFileSync(join(dir, p), 'utf8')]));
const run = (...args: string[]) => publishEnactedOnly(parsePublishConfig(['--enacted-only', '--public-dir', dir, ...args]));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'enacted-only-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  for (const st of ['RI', 'DE']) {
    put(st, 'stats.json', JSON.stringify({ enactedSource: 'old_file', finished: { metrics: { a: 1.5 } }, beforeBalancing: { x: [1, 2] } }));
    put(st, 'enacted.topo.json', '{"old":true}');
    put(st, 'districts.topo.json', '{"districts":true}');
    put(st, 'blocks.json', '{"b":1}');
  }
  writeFileSync(join(dir, 'index.json'), '{"states":[]}');
  vi.mocked(loadEnacted).mockResolvedValue(file('cb_2026_us_cd119_500k'));
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('publish-data --enacted-only', () => {
  it('rebuilds the enacted topology and the enactedSource, and nothing else', async () => {
    const before = snapshot();
    await run();
    const after = snapshot();
    const changed = Object.keys(after).filter((k) => after[k] !== before[k]).sort();
    expect(changed.map((p) => p.replaceAll('\\', '/'))).toEqual(['DE/enacted.topo.json', 'DE/stats.json', 'RI/enacted.topo.json', 'RI/stats.json']);

    const topo = JSON.parse(get('RI', 'enacted.topo.json')) as { type: string; objects: { enacted: { geometries: { properties: { code: string } }[] } } };
    expect(topo.type).toBe('Topology');
    expect(topo.objects.enacted.geometries.map((g) => g.properties.code)).toEqual(['01', '02']);

    // Only the one value changes; key order and every other value are kept.
    expect(get('RI', 'stats.json')).toBe(JSON.stringify({ enactedSource: 'cb_2026_us_cd119_500k', finished: { metrics: { a: 1.5 } }, beforeBalancing: { x: [1, 2] } }));
  });

  it('is idempotent: a second run changes no file', async () => {
    await run();
    const once = snapshot();
    await run();
    expect(snapshot()).toEqual(once);
  });

  it('with --states leaves the other states alone', async () => {
    await run('--states', 'RI');
    expect(get('DE', 'enacted.topo.json')).toBe('{"old":true}');
    expect(JSON.parse(get('DE', 'stats.json')).enactedSource).toBe('old_file');
    expect(JSON.parse(get('RI', 'stats.json')).enactedSource).toBe('cb_2026_us_cd119_500k');
  });

  it('needs no generated plans: the out directory is never read', async () => {
    await run('--out-dir', join(dir, 'does-not-exist'));
    expect(JSON.parse(get('RI', 'stats.json')).enactedSource).toBe('cb_2026_us_cd119_500k');
  });

  it('writes nothing when a state is not published', async () => {
    const before = snapshot();
    await expect(run('--states', 'RI,AK')).rejects.toBeInstanceOf(DataError);
    expect(snapshot()).toEqual(before);
  });

  it('writes nothing when the file has no districts for a published state', async () => {
    vi.mocked(loadEnacted).mockResolvedValue({ source: 'cb_2026_us_cd119_500k', features: [district('44', '01', -73), district('44', '02', -72)] });
    const before = snapshot();
    await expect(run()).rejects.toThrow(/DE: no enacted districts/);
    expect(snapshot()).toEqual(before);
  });
});

describe('downloadForPinning', () => {
  it('downloads without a pinned hash and returns the hash of what it got, then reuses the cached file', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pin-'));
    try {
      const path = join(tmp, 'f.zip');
      const fetchFn = vi.fn<typeof fetch>(async () => new Response('new census bytes', { status: 200 }));
      const want = createHash('sha256').update('new census bytes').digest('hex');
      expect(await downloadForPinning('https://example.test/f.zip', path, 'f', { fetchFn })).toEqual({ path, sha256: want });
      expect(await downloadForPinning('https://example.test/f.zip', path, 'f', { fetchFn })).toEqual({ path, sha256: want });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
