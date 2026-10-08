import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Block } from '../../../src/server/entities/census-block/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';

vi.mock('../../../src/server/entities/census-block/index.js', async (orig) => ({
  ...(await orig<typeof import('../../../src/server/entities/census-block/index.js')>()),
  loadStateBlocks: vi.fn(),
  loadBlockPolygons: vi.fn(),
}));

const { loadStateBlocks, loadBlockPolygons } = await import('../../../src/server/entities/census-block/index.js');
const { publishBlocksOnly, encodeBlocks } = await import('../../../src/server/features/publish/index.js');
const { parsePublishConfig } = await import('../../../src/server/shared/config/index.js');

const STEP = 0.002;
const FP = { finished: 'a'.repeat(64), before: 'b'.repeat(64) };
const id = (fips: string, c: number, r: number): string => `${fips}001${String(c).padStart(5, '0')}${String(r).padStart(5, '0')}`;

/** An n by n grid of square blocks sharing exact corner coordinates, like TIGER. */
function grid(fips: string, n: number): Block[] {
  const out: Block[] = [];
  for (let c = 0; c < n; c++) {
    for (let r = 0; r < n; r++) {
      const [x0, x1, y0, y1] = [-71.5 + c * STEP, -71.5 + (c + 1) * STEP, 41.5 + r * STEP, 41.5 + (r + 1) * STEP];
      out.push({ geoid: id(fips, c, r), pop: c + r, point: [x0 + STEP / 2, y0 + STEP / 2], rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] });
    }
  }
  return out;
}
const csv = (blocks: Block[], of: (geoid: string) => number): string => `GEOID20,district\n${blocks.map((b) => `${b.geoid},${of(b.geoid)}`).join('\n')}\n`;
const column = (g: string): number => Number(g.slice(5, 10));

const ri = grid('44', 4);
const de = grid('10', 4);
const riBlocks = (): string =>
  JSON.stringify(encodeBlocks('44', 2, csv(ri, (g) => (column(g) < 2 ? 1 : 2)), csv(ri, (g) => (column(g) < 1 ? 1 : 2)), FP));
const deBlocks = (): string => JSON.stringify(encodeBlocks('10', 1, csv(de, () => 1), csv(de, () => 1), FP));
const stats = (fp = FP): string => JSON.stringify({ finished: { metrics: { assignmentSha256: fp.finished } }, beforeBalancing: { metrics: { assignmentSha256: fp.before } } });

let dir: string;
const put = (st: string, name: string, body: string): void => {
  mkdirSync(join(dir, st), { recursive: true });
  writeFileSync(join(dir, st, name), body);
};
const snapshot = (): Record<string, string> =>
  Object.fromEntries(readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((p) => !p.endsWith('blocks.pmtiles') && /\.[a-z]+$/.test(p)).sort().map((p) => [p, readFileSync(join(dir, p), 'utf8')]));
const run = (...args: string[]) => publishBlocksOnly(parsePublishConfig(['--blocks-only', '--public-dir', dir, ...args]));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'blocks-only-'));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.mocked(loadStateBlocks).mockImplementation(async (s) => (s.fips === '44' ? ri : de));
  vi.mocked(loadBlockPolygons).mockImplementation(async (s, _dir, geoids) => {
    const all = s.fips === '44' ? ri : de;
    return new Map(all.filter((b) => geoids.has(b.geoid)).map((b) => [b.geoid, [b.rings.map((r) => r.map((p) => [p[0], p[1]] as [number, number]))]] as never));
  });
  for (const st of ['RI', 'DE']) {
    put(st, 'stats.json', stats());
    put(st, 'detail.pmtiles', 'detail bytes');
    put(st, 'districts.topo.json', '{"districts":true}');
  }
  put('RI', 'blocks.json', riBlocks());
  put('DE', 'blocks.json', deBlocks());
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('publish-data --blocks-only', () => {
  it('writes only blocks.pmtiles; every other file keeps its bytes', async () => {
    const before = snapshot();
    await run('--states', 'RI');
    expect(snapshot()).toEqual(before);
    const bytes = readFileSync(join(dir, 'RI', 'blocks.pmtiles'));
    expect(bytes.subarray(0, 7).toString('latin1')).toBe('PMTiles');
  });

  it('writes no file for a one-district state and removes a stale one', async () => {
    await run('--states', 'DE');
    expect(existsSync(join(dir, 'DE', 'blocks.pmtiles'))).toBe(false);
    put('DE', 'blocks.pmtiles', 'stale');
    await run('--states', 'DE');
    expect(existsSync(join(dir, 'DE', 'blocks.pmtiles'))).toBe(false);
  });

  it('rejects a state with no stats.json', async () => {
    rmSync(join(dir, 'RI', 'stats.json'));
    await expect(run('--states', 'RI')).rejects.toThrow(/nothing published/);
  });

  it('rejects a blocks.json that fails the schema', async () => {
    put('RI', 'blocks.json', '{"v":2}');
    await expect(run('--states', 'RI')).rejects.toBeInstanceOf(DataError);
  });

  it('rejects a blocks.json of another state', async () => {
    put('RI', 'blocks.json', JSON.stringify({ ...JSON.parse(riBlocks()), state: '09' }));
    await expect(run('--states', 'RI')).rejects.toThrow(/is not the file of RI/);
  });

  it('rejects a blocks.json with a different seat count', async () => {
    put('RI', 'blocks.json', JSON.stringify({ ...JSON.parse(riBlocks()), seats: 3 }));
    await expect(run('--states', 'RI')).rejects.toThrow(/is not the file of RI/);
  });

  it('rejects a district above the seat count', async () => {
    const file = JSON.parse(riBlocks()) as { tracts: Record<string, number[]> };
    const first = Object.keys(file.tracts)[0]!;
    file.tracts[first] = [3, 1];
    put('RI', 'blocks.json', JSON.stringify(file));
    await expect(run('--states', 'RI')).rejects.toThrow(/above 2/);
  });

  it('rejects a block the TIGER file has and blocks.json lacks', async () => {
    vi.mocked(loadStateBlocks).mockResolvedValue([...ri, { ...ri[0]!, geoid: id('44', 9, 9) }]);
    await expect(run('--states', 'RI')).rejects.toThrow(/is not in/);
  });

  it('rejects fingerprints that differ from stats.json', async () => {
    put('RI', 'stats.json', stats({ finished: 'c'.repeat(64), before: FP.before }));
    await expect(run('--states', 'RI')).rejects.toThrow(/fingerprints differ/);
  });

  it('rejects fingerprints that are not 64 hex characters', async () => {
    put('RI', 'blocks.json', JSON.stringify({ ...JSON.parse(riBlocks()), fingerprints: { finished: 'x', before: 'y' } }));
    await expect(run('--states', 'RI')).rejects.toBeInstanceOf(DataError);
  });
});
