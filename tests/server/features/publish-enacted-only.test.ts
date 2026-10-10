import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnactedFile } from '../../../src/server/features/publish/boundary.js';
import { adoptIfAccepted, downloadForPinning } from '../../../src/server/shared/http/index.js';
import { stampOf, VERSIONS } from '../../../src/server/shared/config/index.js';
import { DataError, DownloadError } from '../../../src/server/shared/errors/index.js';

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

describe('publish-data --enacted-only on stamped data', () => {
  const OLD_STAMP = { engine: '0.9.0', input: { vintage: 'census-2020', revision: 0, sha256: 'c'.repeat(64) }, maps: 0, schema: '0.8.0' };
  const SHA = 'd'.repeat(64);

  it('moves only versions.maps and versions.input to the current release (engine and schema stay), in stats and index, without the gate', async () => {
    for (const st of ['RI', 'DE']) {
      put(st, 'stats.json', JSON.stringify({ enactedSource: 'old_file', versions: OLD_STAMP, finished: { metrics: { assignmentSha256: SHA } }, beforeBalancing: { x: [1, 2] } }));
    }
    writeFileSync(join(dir, 'index.json'), JSON.stringify({ states: [{ abbr: 'RI', summary: { assignmentSha256: SHA, versions: OLD_STAMP } }, { abbr: 'DE', summary: { assignmentSha256: SHA, versions: OLD_STAMP } }, { abbr: 'AK', hasData: false }] }));
    await run();
    const stamp = { ...stampOf(VERSIONS), engine: OLD_STAMP.engine, schema: OLD_STAMP.schema };
    for (const st of ['RI', 'DE']) {
      expect(get(st, 'stats.json')).toBe(JSON.stringify({ enactedSource: 'cb_2026_us_cd119_500k', versions: stamp, finished: { metrics: { assignmentSha256: SHA } }, beforeBalancing: { x: [1, 2] } }));
    }
    const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as { states: { abbr: string; summary?: { versions: unknown; assignmentSha256: string } }[] };
    expect(index.states.filter((e) => e.summary).map((e) => e.summary!.versions)).toEqual([stamp, stamp]);
    expect(index.states.every((e) => e.summary === undefined || e.summary.assignmentSha256 === SHA)).toBe(true);
    expect(index.states[2]).toEqual({ abbr: 'AK', hasData: false });
    expect(readFileSync(join(dir, 'versions.json'), 'utf8')).toBe(`${JSON.stringify(VERSIONS, null, 2)}
`);
  });

  it('keeps engine, schema, web and docs in an existing public versions.json, and moves only maps and input', async () => {
    for (const st of ['RI', 'DE']) {
      put(st, 'stats.json', JSON.stringify({ enactedSource: 'old_file', versions: OLD_STAMP, finished: { metrics: { assignmentSha256: SHA } } }));
    }
    const published = { ...VERSIONS, engine: '0.9.0', schema: '0.8.0', web: '0.7.0', docs: '0.6.0', input: { ...VERSIONS.input, sha256: 'c'.repeat(64) } };
    writeFileSync(join(dir, 'versions.json'), `${JSON.stringify(published, null, 2)}\n`);
    await run();
    expect(JSON.parse(readFileSync(join(dir, 'versions.json'), 'utf8'))).toEqual({ ...published, maps: VERSIONS.maps, input: VERSIONS.input });
  });

  it('does not stamp states that were published without a stamp', async () => {
    await run();
    expect(JSON.parse(get('RI', 'stats.json'))).not.toHaveProperty('versions');
  });
});

describe('downloadForPinning', () => {
  const URL_ = 'https://www2.census.gov/f.zip';
  const sha = (b: string): string => createHash('sha256').update(b).digest('hex');
  let tmp: string;
  let path: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pin-'));
    path = join(tmp, 'f.zip');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmp, { recursive: true, force: true });
  });

  it('downloads to a file of its own and returns the hash of what it got, leaving no cache behind', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response('new census bytes', { status: 200 }));
    const got = await downloadForPinning(URL_, path, 'f', { fetchFn });
    expect(got.sha256).toBe(sha('new census bytes'));
    expect(got.path).not.toBe(path);
    expect(readFileSync(got.path, 'utf8')).toBe('new census bytes');
    expect(existsSync(path)).toBe(false);
  });
  it('does not trust or touch a cached file, and warns when it differs', async () => {
    writeFileSync(path, 'stale bytes');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetchFn = vi.fn<typeof fetch>(async () => new Response('new census bytes', { status: 200 }));
    const got = await downloadForPinning(URL_, path, 'f', { fetchFn });
    expect(got.sha256).toBe(sha('new census bytes'));
    expect(readFileSync(path, 'utf8')).toBe('stale bytes');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('differs'));
  });
  it('does not warn when the cached file is identical', async () => {
    writeFileSync(path, 'same bytes');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await downloadForPinning(URL_, path, 'f', { fetchFn: async () => new Response('same bytes', { status: 200 }) });
    expect(warn).not.toHaveBeenCalled();
  });
  it('leaves the cached file intact and no temporary file when the fetch fails', async () => {
    writeFileSync(path, 'pinned bytes');
    const fetchFn = vi.fn<typeof fetch>(async () => new Response('gone', { status: 404 }));
    await expect(downloadForPinning(URL_, path, 'f', { fetchFn, sleep: async () => undefined })).rejects.toBeInstanceOf(DownloadError);
    expect(readFileSync(path, 'utf8')).toBe('pinned bytes');
    expect(readdirSync(tmp)).toEqual(['f.zip']);
  });
});

describe('adoptIfAccepted', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'adopt-'));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('replaces the cache once the bump is accepted', async () => {
    writeFileSync(join(tmp, 'f.zip'), 'old');
    writeFileSync(join(tmp, 'f.fresh'), 'new');
    expect(await adoptIfAccepted(join(tmp, 'f.fresh'), join(tmp, 'f.zip'), async () => 'ok')).toBe('ok');
    expect(readFileSync(join(tmp, 'f.zip'), 'utf8')).toBe('new');
    expect(readdirSync(tmp)).toEqual(['f.zip']);
  });
  it('keeps the cache and removes the download when the bump is refused', async () => {
    writeFileSync(join(tmp, 'f.zip'), 'pinned');
    writeFileSync(join(tmp, 'f.fresh'), 'new');
    await expect(adoptIfAccepted(join(tmp, 'f.fresh'), join(tmp, 'f.zip'), async () => Promise.reject(new DataError('refused')))).rejects.toThrow('refused');
    expect(readFileSync(join(tmp, 'f.zip'), 'utf8')).toBe('pinned');
    expect(readdirSync(tmp)).toEqual(['f.zip']);
  });
});
