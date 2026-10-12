import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyBump, applyLegislativeBump, checkNoChamberLost, fixturesWithChangedCounts, formatEnacted, formatManifest, LEGISLATIVE_CONFIG_FILES, planBump, planVersionBump,
  publishAllChambers, withConfigRestored,
} from '../../../src/server/features/enacted/index.js';
import { CENSUS_SHA256, ENACTED_CONFIG, EnactedConfigSchema, parseEnactedBumpConfig, VERSIONS, VersionsSchema } from '../../../src/server/shared/config/index.js';
import { ConfigError, DataError } from '../../../src/server/shared/errors/index.js';

const HASH = 'ab'.repeat(32);
const current = EnactedConfigSchema.parse({ congress: 119, file: 'cb_2025_us_cd119_500k', candidates: ['cb_2025_us_cd119_500k', 'cb_2024_us_cd119_500k'], legislative: { vintage: 2025 } });
const manifest = { ...CENSUS_SHA256 };

describe('the committed config files', () => {
  it('are in the exact layout the bump writes, so a bump changes only what it must', () => {
    expect(formatEnacted(ENACTED_CONFIG)).toBe(readFileSync('config/enacted.json', 'utf8'));
    expect(formatManifest(CENSUS_SHA256)).toBe(readFileSync('config/census-sha256.json', 'utf8'));
  });
});

describe('planBump', () => {
  it('adopts a newer release of the same Congress and keeps the previous one as a fallback', () => {
    const plan = planBump(current, manifest, 'cb_2026_us_cd119_500k', HASH);
    expect(plan.config).toEqual({ congress: 119, file: 'cb_2026_us_cd119_500k', candidates: ['cb_2026_us_cd119_500k', 'cb_2025_us_cd119_500k'], legislative: { vintage: 2025 } });
    expect(plan.manifest['cb_2026_us_cd119_500k.zip']).toBe(HASH);
    expect(plan.manifest['cb_2025_us_cd119_500k.zip']).toBe(manifest['cb_2025_us_cd119_500k.zip']);
    expect(plan.manifest).not.toHaveProperty(['cb_2024_us_cd119_500k.zip']);
  });
  it('moves to the next Congress, dropping every old enacted file from the manifest', () => {
    const plan = planBump(current, manifest, 'cb_2027_us_cd120_500k', HASH);
    expect(plan.config).toEqual({ congress: 120, file: 'cb_2027_us_cd120_500k', candidates: ['cb_2027_us_cd120_500k'], legislative: { vintage: 2025 } });
    expect(Object.keys(plan.manifest).filter((k) => /_cd\d+_500k\.zip$/.test(k))).toEqual(['cb_2027_us_cd120_500k.zip']);
  });
  it('leaves every other manifest entry untouched and keeps the keys sorted', () => {
    const plan = planBump(current, manifest, 'cb_2027_us_cd120_500k', HASH);
    for (const [k, v] of Object.entries(manifest)) if (!/_cd\d+_500k\.zip$/.test(k)) expect(plan.manifest[k]).toBe(v);
    expect(Object.keys(plan.manifest)).toEqual([...Object.keys(plan.manifest)].sort());
  });
  it('is a no-op for the file already pinned', () => {
    const plan = planBump(current, manifest, current.file, manifest[`${current.file}.zip`]!);
    expect(plan.config).toEqual(current);
    expect(plan.manifest).toEqual(manifest);
  });
  it('refuses an older file, a malformed name and a bad hash', () => {
    expect(() => planBump(current, manifest, 'cb_2024_us_cd119_500k', HASH)).toThrow(ConfigError);
    expect(() => planBump(current, manifest, 'cb_2027_us_cd118_500k', HASH)).toThrow(ConfigError);
    expect(() => planBump(current, manifest, 'cb_2027_us_state_20m', HASH)).toThrow(ConfigError);
    expect(() => planBump(current, manifest, 'cb_2027_us_cd120_500k', 'nope')).toThrow(ConfigError);
  });
  it('refuses to re-pin a file under a different hash', () => {
    expect(() => planBump(current, manifest, current.file, HASH)).toThrow(DataError);
  });
});

describe('applyBump on a temp copy of the config', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'enacted-bump-'));
    for (const f of ['enacted.json', 'census-sha256.json']) copyFileSync(join('config', f), join(dir, f));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('rewrites both files and leaves them valid', async () => {
    await applyBump(dir, 'cb_2027_us_cd120_500k', HASH);
    expect(readFileSync(join(dir, 'enacted.json'), 'utf8')).toBe(
      '{\n  "congress": 120,\n  "file": "cb_2027_us_cd120_500k",\n  "candidates": ["cb_2027_us_cd120_500k"],\n  "legislative": { "vintage": 2025 }\n}\n',
    );
    const written = JSON.parse(readFileSync(join(dir, 'census-sha256.json'), 'utf8')) as Record<string, string>;
    expect(written['cb_2027_us_cd120_500k.zip']).toBe(HASH);
    expect(written).not.toHaveProperty(['cb_2025_us_cd119_500k.zip']);
    expect(Object.keys(written)).toHaveLength(Object.keys(CENSUS_SHA256).length - 1);
    expect(EnactedConfigSchema.safeParse(JSON.parse(readFileSync(join(dir, 'enacted.json'), 'utf8'))).success).toBe(true);
  });
  it('changes nothing when it refuses', async () => {
    const before = readFileSync(join(dir, 'enacted.json'), 'utf8');
    await expect(applyBump(dir, 'cb_2020_us_cd116_500k', HASH)).rejects.toBeInstanceOf(ConfigError);
    expect(readFileSync(join(dir, 'enacted.json'), 'utf8')).toBe(before);
  });
  it('a second bump to the same file changes nothing', async () => {
    await applyBump(dir, 'cb_2026_us_cd119_500k', HASH);
    const [a, b] = ['enacted.json', 'census-sha256.json'].map((f) => readFileSync(join(dir, f), 'utf8'));
    await applyBump(dir, 'cb_2026_us_cd119_500k', HASH);
    expect([a, b]).toEqual(['enacted.json', 'census-sha256.json'].map((f) => readFileSync(join(dir, f), 'utf8')));
  });
});

describe('parseEnactedBumpConfig', () => {
  it('needs a file name without .zip and defaults the directories', () => {
    expect(parseEnactedBumpConfig(['--file', 'cb_2027_us_cd120_500k'])).toEqual({
      file: 'cb_2027_us_cd120_500k', cacheDir: 'data/raw', publicDir: 'public/data', configDir: 'config', skipPublish: false,
    });
    expect(() => parseEnactedBumpConfig([])).toThrow(ConfigError);
    expect(() => parseEnactedBumpConfig(['--file', 'cb_2027_us_cd120_500k.zip'])).toThrow(ConfigError);
  });
});

describe('planVersionBump', () => {
  it('moves the input revision and fingerprint and the maps release, and nothing else', () => {
    const sha = 'e'.repeat(64);
    const next = planVersionBump(VERSIONS, sha);
    expect(next.input).toEqual({ ...VERSIONS.input, revision: VERSIONS.input.revision + 1, sha256: sha });
    expect(next.maps).toBe(VERSIONS.maps + 1);
    expect({ ...next, input: VERSIONS.input, maps: VERSIONS.maps }).toEqual(VERSIONS);
  });
  it('from the 1.0 baseline gives input revision 2 and maps 2 with the engine unchanged', () => {
    const baseline = VersionsSchema.parse({ ...VERSIONS, engine: '1.0.0', input: { ...VERSIONS.input, revision: 1 }, maps: 1 });
    const next = planVersionBump(baseline, 'f'.repeat(64));
    expect([next.input.revision, next.maps, next.engine]).toEqual([2, 2, '1.0.0']);
  });
});

describe('enacted:bump publishes every chamber', () => {
  it('restamps the Federal House, then the State House, then the State Senate, each once', () => {
    const calls: (string | undefined)[] = [];
    publishAllChambers((chamber) => calls.push(chamber));
    expect(calls).toEqual([undefined, 'state-house', 'state-senate']);
  });
  it('stops at the first chamber that fails, so a later one is not restamped over an older stamp', () => {
    const calls: (string | undefined)[] = [];
    expect(() => publishAllChambers((chamber) => {
      calls.push(chamber);
      if (chamber === 'state-house') throw new DataError('publish failed');
    })).toThrow(DataError);
    expect(calls).toEqual([undefined, 'state-house']);
  });
});

describe('withConfigRestored', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'config-restore-'));
    writeFileSync(join(dir, 'enacted.json'), 'old enacted');
    writeFileSync(join(dir, 'census-sha256.json'), 'old manifest');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('puts every file back, and removes one that did not exist, when the step fails', async () => {
    await expect(withConfigRestored(dir, ['enacted.json', 'census-sha256.json', 'legislative-districts.json'], async () => {
      writeFileSync(join(dir, 'enacted.json'), 'new enacted');
      rmSync(join(dir, 'census-sha256.json'));
      writeFileSync(join(dir, 'legislative-districts.json'), 'new counts');
      throw new DataError('pin failed');
    })).rejects.toThrow('pin failed');
    expect(readFileSync(join(dir, 'enacted.json'), 'utf8')).toBe('old enacted');
    expect(readFileSync(join(dir, 'census-sha256.json'), 'utf8')).toBe('old manifest');
    expect(existsSync(join(dir, 'legislative-districts.json'))).toBe(false);
  });
  it('keeps the new files when the step succeeds, and returns its value', async () => {
    const got = await withConfigRestored(dir, ['enacted.json'], async () => {
      writeFileSync(join(dir, 'enacted.json'), 'new enacted');
      return 7;
    });
    expect(got).toBe(7);
    expect(readFileSync(join(dir, 'enacted.json'), 'utf8')).toBe('new enacted');
  });
  it('restores the config after a real bump when the chamber check refuses it', async () => {
    const real = mkdtempSync(join(tmpdir(), 'config-bump-'));
    try {
      for (const name of ['enacted.json', 'census-sha256.json', 'census-sources.json']) copyFileSync(join('config', name), join(real, name));
      const before = readFileSync(join(real, 'enacted.json'), 'utf8');
      await expect(withConfigRestored(real, LEGISLATIVE_CONFIG_FILES, async () => {
        await applyLegislativeBump(real, ENACTED_CONFIG.legislative.vintage + 1);
        expect(readFileSync(join(real, 'enacted.json'), 'utf8')).not.toBe(before);
        checkNoChamberLost({ CO: { 'state-house': 65 } }, { CO: { 'state-house': 0 } });
      })).rejects.toThrow(DataError);
      expect(readFileSync(join(real, 'enacted.json'), 'utf8')).toBe(before);
    } finally {
      rmSync(real, { recursive: true, force: true });
    }
  });
});

describe('fixturesWithChangedCounts', () => {
  const before = { CO: { 'state-house': 65, 'state-senate': 35 }, VT: { 'state-house': 150, 'state-senate': 30 } };
  const after = { CO: { 'state-house': 66, 'state-senate': 35 }, VT: { 'state-house': 150, 'state-senate': 31 } };
  it('names the recorded chamber fixtures whose count moved, never a federal one', () => {
    expect(fixturesWithChangedCounts(before, after, ['CO', 'CO:state-house', 'CO:state-senate', 'VT:state-senate', 'RI:state-house'])).toEqual(['CO:state-house', 'VT:state-senate']);
  });
});
