import { describe, expect, it, vi } from 'vitest';
import { checkNoChamberLost, detectLegislative, detectLegislativeSafely, planLegislativeBump, redrawLines } from '../../../src/server/features/enacted/index.js';
import { EnactedConfigSchema, parseEnactedBumpConfig } from '../../../src/server/shared/config/index.js';
import { ConfigError, DataError } from '../../../src/server/shared/errors/index.js';

const current = EnactedConfigSchema.parse({ congress: 119, file: 'cb_2025_us_cd119_500k', candidates: ['cb_2025_us_cd119_500k'], legislative: { vintage: 2025 } });

describe('redrawLines', () => {
  it('names each state chamber whose count changed, and nothing else', () => {
    expect(redrawLines({ CO: { 'state-house': 65 } }, { CO: { 'state-house': 66 } })).toEqual(['CO state-house: 65 to 66 districts; redraw needed']);
    expect(redrawLines({ CO: { 'state-house': 65, 'state-senate': 35 } }, { CO: { 'state-house': 65, 'state-senate': 35 } })).toEqual([]);
  });
  it('lists states and chambers in a fixed order', () => {
    const lines = redrawLines(
      { WY: { 'state-house': 60, 'state-senate': 30 }, CO: { 'state-house': 65, 'state-senate': 35 } },
      { WY: { 'state-house': 60, 'state-senate': 31 }, CO: { 'state-house': 66, 'state-senate': 36 } },
    );
    expect(lines).toEqual([
      'CO state-house: 65 to 66 districts; redraw needed',
      'CO state-senate: 35 to 36 districts; redraw needed',
      'WY state-senate: 30 to 31 districts; redraw needed',
    ]);
  });
});

describe('checkNoChamberLost', () => {
  it('refuses a chamber that goes from districts to none, naming the state and chamber', () => {
    expect(() => checkNoChamberLost({ CO: { 'state-house': 65, 'state-senate': 35 } }, { CO: { 'state-house': 65, 'state-senate': 0 } })).toThrow(
      new DataError('CO state-senate: 35 districts before, 0 in the new files; refusing the update, check the downloaded files'),
    );
  });
  it('allows a chamber that had none, a changed count, and a count that stays', () => {
    expect(() => checkNoChamberLost({ NE: { 'state-house': 0, 'state-senate': 49 }, CO: { 'state-house': 65 } }, { NE: { 'state-house': 0, 'state-senate': 49 }, CO: { 'state-house': 66 } })).not.toThrow();
  });
});

describe('detectLegislativeSafely', () => {
  it('reports a failed probe instead of throwing', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response('x', { status: 500 }));
    const got = await detectLegislativeSafely(current, { fetchFn, sleep: async () => undefined });
    expect(got).toEqual({ update: false, vintage: 2025, error: 'probe failed' });
  });
});

describe('planLegislativeBump', () => {
  it('moves only the legislative vintage', () => {
    expect(planLegislativeBump(current, 2026)).toEqual({ ...current, legislative: { vintage: 2026 } });
  });
  it('refuses an equal or older vintage', () => {
    expect(() => planLegislativeBump(current, 2025)).toThrow(ConfigError);
    expect(() => planLegislativeBump(current, 2024)).toThrow(ConfigError);
  });
});

describe('detectLegislative', () => {
  const served = (urls: readonly string[]): typeof fetch =>
    vi.fn<typeof fetch>(async (input) =>
      urls.includes(String(input))
        ? new Response(null, { status: 200, headers: { 'content-type': 'application/zip' } })
        : new Response('<html></html>', { status: 404, headers: { 'content-type': 'text/html' } }));
  it('reports the next vintage when its Alabama Senate file is served', async () => {
    const fetchFn = served(['https://www2.census.gov/geo/tiger/GENZ2026/shp/cb_2026_01_sldu_500k.zip']);
    expect(await detectLegislative(current, { fetchFn })).toEqual({ update: true, vintage: 2026 });
  });
  it('reports no update, at the pinned vintage, when it is not', async () => {
    expect(await detectLegislative(current, { fetchFn: served([]) })).toEqual({ update: false, vintage: 2025 });
  });
});

describe('parseEnactedBumpConfig with --legislative', () => {
  it('takes a vintage and defaults the directories', () => {
    expect(parseEnactedBumpConfig(['--legislative', '2026'])).toEqual({
      legislative: 2026, cacheDir: 'data/raw', publicDir: 'public/data', configDir: 'config', skipPublish: false,
    });
  });
  it('wants exactly one of --file and --legislative, and a four-digit year', () => {
    expect(() => parseEnactedBumpConfig(['--legislative', '2026', '--file', 'cb_2027_us_cd120_500k'])).toThrow(ConfigError);
    expect(() => parseEnactedBumpConfig(['--legislative', '26'])).toThrow(ConfigError);
  });
});
