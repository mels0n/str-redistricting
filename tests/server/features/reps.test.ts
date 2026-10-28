import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkAliases, matchStateDistricts, parseCongress, parseCsv, parseOpenStates, buildWebsites, publishableWebsite, publishReps, websiteHost, WebsitesSchema, StateRepsSchema } from '../../../src/server/features/reps/index.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/reps');
const read = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');
const json = (name: string): unknown => JSON.parse(read(name)) as unknown;
const sha = (name: string): string => createHash('sha256').update(readFileSync(join(FIXTURES, name))).digest('hex');

describe('parseCongress', () => {
  const out = parseCongress(json('legislators-current.json'), json('legislators-social-media.json'));

  it('reads a House member from the last term and the social file', () => {
    const hurd = out.find((r) => r.id === 'H001100')!;
    expect(hurd).toMatchObject({ state: 'CO', office: 'us-house', districtCode: '03', phone: '202-225-4676', website: 'https://hurd.house.gov' });
    expect(hurd.address).toContain('Longworth');
    expect(hurd.social.x).toBe('RepJeffHurd');
    // The upstream file lists no contact form for House members.
    expect(hurd.contactUrl).toBeNull();
  });

  it('takes the contact form of a senator, who has no district', () => {
    const bennet = out.find((r) => r.id === 'B001267')!;
    expect(bennet).toMatchObject({ office: 'us-senate', districtCode: null });
    expect(bennet.contactUrl).toMatch(/^https:\/\/www\.bennet\.senate\.gov/);
  });

  it('gives an at-large member 00 and keeps no party', () => {
    expect(out.find((r) => r.id === 'B001318')).toMatchObject({ state: 'VT', districtCode: '00' });
    expect(JSON.stringify(out)).not.toMatch(/party/i);
  });
});

describe('parseOpenStates', () => {
  it('maps chambers and takes email, capitol phone and address, and the first link', () => {
    const { reps, skipped } = parseOpenStates(read('co.csv'), 'CO');
    expect(skipped).toBe(0);
    expect(reps).toHaveLength(6);
    expect(reps.filter((r) => r.office === 'state-senate')).toHaveLength(2);
    expect(reps.filter((r) => r.office === 'state-house')).toHaveLength(4);
    const first = reps[0]!;
    expect(first.id).toMatch(/^ocd-person\//);
    expect(first.email).toMatch(/@/);
    expect(first.website).toMatch(/^https:\/\/leg\.colorado\.gov\/legislators\//);
    expect(first.website).not.toContain(';');
    expect(JSON.stringify(reps)).not.toMatch(/party|Democratic|Republican/i);
  });

  it('keeps two members of one district as two reps', () => {
    const { reps } = parseOpenStates(read('vt.csv'), 'VT');
    expect(reps.filter((r) => r.districtCode === 'Windsor')).toHaveLength(2);
  });

  it('skips and counts a row that fails validation', () => {
    const csv = read('co.csv').trimEnd();
    const bad = `${csv}\nnot-an-id,Nobody,,5,joint,,,,,,,,,,,,,,,,,,,,,\n`;
    expect(parseOpenStates(bad, 'CO').skipped).toBe(1);
  });
});

describe('parseCsv', () => {
  it('handles quoted commas, doubled quotes and embedded newlines', () => {
    expect(parseCsv('a,b\r\n"x,1","he said ""hi""\nthere"\nlast,')).toEqual([['a', 'b'], ['x,1', 'he said "hi"\nthere'], ['last', '']]);
  });
});

describe('matchStateDistricts', () => {
  it('matches numbers regardless of leading zeros', () => {
    const m = matchStateDistricts('CO', 'state-senate', ['001', '012'], ['1', '12'], {});
    expect(m.matched).toEqual({ '001': '1', '012': '12' });
    expect(m.unmatchedEnacted).toEqual([]);
    expect(m.unmatchedOpenStates).toEqual([]);
  });

  it('leaves a name that does not agree unmatched until an alias names it', () => {
    const plain = matchStateDistricts('VT', 'state-senate', ['CHI'], ['Chittenden-Central'], {});
    expect(plain.unmatchedEnacted).toEqual(['CHI']);
    expect(plain.unmatchedOpenStates).toEqual(['Chittenden-Central']);
    const aliased = matchStateDistricts('VT', 'state-senate', ['CHI'], ['Chittenden-Central'], { 'VT:state-senate:CHI': 'Chittenden-Central' });
    expect(aliased.matched).toEqual({ CHI: 'Chittenden-Central' });
    expect(aliased.unmatchedEnacted).toEqual([]);
  });

  it('ignores case, spaces, hyphens and the word district', () => {
    expect(matchStateDistricts('VT', 'state-house', ['CHITTENDEN-CENTRAL'], ['Chittenden Central District'], {}).unmatchedEnacted).toEqual([]);
  });
});

describe('matchStateDistricts collisions', () => {
  it('throws when two Open States names normalise to the same string', () => {
    expect(() => matchStateDistricts('XX', 'state-house', ['001'], ['1', '01'], {})).toThrow(/normalise to the same name/);
  });
});

describe('checkAliases', () => {
  const os = ['Chittenden-Central', 'Windsor', '1A', '1B'];
  it('accepts sound aliases, including a | list', () => {
    expect(checkAliases('VT', 'state-senate', ['CHI', '001'], os, { 'VT:state-senate:CHI': 'Chittenden-Central', 'VT:state-senate:001': '1A|1B' })).toEqual([]);
  });
  it('flags a target that is not an exact Open States name', () => {
    expect(checkAliases('VT', 'state-senate', ['CHI'], os, { 'VT:state-senate:CHI': 'Chittenden Central' })).toHaveLength(1);
  });
  it('flags an Open States name claimed twice', () => {
    expect(checkAliases('VT', 'state-senate', ['CHI', 'CHC'], os, { 'VT:state-senate:CHI': 'Windsor', 'VT:state-senate:CHC': 'Windsor' }).join()).toMatch(/also claimed/);
  });
  it('flags an alias for a code that matches without it, and for an unknown code', () => {
    expect(checkAliases('VT', 'state-senate', ['WINDSOR'], os, { 'VT:state-senate:WINDSOR': 'Windsor' }).join()).toMatch(/already matches/);
    expect(checkAliases('VT', 'state-senate', ['CHI'], os, { 'VT:state-senate:ZZZ': 'Windsor' }).join()).toMatch(/no such enacted/);
  });
  it('ignores aliases of another state or chamber', () => {
    expect(checkAliases('VT', 'state-senate', ['CHI'], os, { 'NH:state-house:001': 'nope' })).toEqual([]);
  });
});

describe('publishableWebsite', () => {
  it('drops a party or caucus host and keeps an official one', () => {
    for (const u of ['https://www.housegop.org/x', 'https://senatedemocrats.com', 'https://www.republicanhouse.org', 'https://dems.example.gov', 'https://caucus.example.org']) expect(publishableWebsite(u)).toBeNull();
    expect(publishableWebsite('https://hurd.house.gov')).toBe('https://hurd.house.gov');
    expect(publishableWebsite('')).toBeNull();
    expect(publishableWebsite('not a url')).toBeNull();
  });
  it('is applied to Open States links', () => {
    const swapped = read('co.csv').replaceAll('https://leg.colorado.gov/legislators/', 'https://www.coloradohousegop.com/');
    const out = parseOpenStates(swapped, 'CO');
    expect(out.reps.every((x) => x.website === null)).toBe(true);
    expect(out.reps.some((x) => x.website === null)).toBe(true);
    expect(JSON.stringify(out.reps)).not.toMatch(/housegop/);
  });
});

describe('buildWebsites', () => {
  const rep = (id: string, name: string, website: string | null, office: 'us-house' | 'state-senate' = 'us-house') => ({ id, name, office, districtCode: '01', contactUrl: null, email: null, phone: null, address: null, website, social: {} });
  const file = (state: string, reps: ReturnType<typeof rep>[]) => ({ state, generatedFrom: {}, byKey: { [`${state}:x:01`]: reps } }) as never;

  it('maps each host, www removed and lower-cased, to the person, with no party or contact details', () => {
    const out = buildWebsites([file('CO', [rep('A', 'Ann Lee', 'https://www.Lee.house.gov/about'), rep('B', 'Bo Kim', null), rep('C', 'Cy Poe', 'not a url', 'state-senate')])]);
    expect(out).toEqual({ 'lee.house.gov': { name: 'Ann Lee', office: 'us-house', state: 'CO', id: 'A' } });
    expect(WebsitesSchema.safeParse(out).success).toBe(true);
  });
  it('leaves out a host two people share', () => {
    const out = buildWebsites([file('CO', [rep('A', 'Ann', 'https://shared.example.org/a'), rep('B', 'Bo', 'https://www.shared.example.org/b'), rep('C', 'Cy', 'https://cy.example.org')])]);
    expect(Object.keys(out)).toEqual(['cy.example.org']);
  });
  it('reads a host from a website address', () => {
    expect(websiteHost('https://WWW.Example.com/x')).toBe('example.com');
    expect(websiteHost('')).toBeNull();
    expect(websiteHost(null)).toBeNull();
  });
});

describe('publishReps', () => {
  let dir: string;
  const topo = (path: string, codes: string[]): void => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ objects: { enacted: { geometries: codes.map((code) => ({ properties: { label: code, code } })) } } }));
  };
  const setup = (overrides: Record<string, string> = {}, usHouse = ['03']): { configDir: string; cacheDir: string; publicDir: string; only: string[] } => {
    const configDir = join(dir, 'config');
    const cacheDir = join(dir, 'cache');
    const publicDir = join(dir, 'public');
    mkdirSync(configDir);
    mkdirSync(cacheDir);
    const files: Record<string, string> = { 'legislators-current.json': 'legislators-current.json', 'legislators-social-media.json': 'legislators-social-media.json', 'co.csv': 'co.csv' };
    const sources: Record<string, { url: string; sha256: string }> = {};
    for (const [name, fixture] of Object.entries(files)) {
      copyFileSync(join(FIXTURES, fixture), join(cacheDir, name));
      sources[name] = { url: `https://data.openstates.org/${name}`, sha256: overrides[name] ?? sha(fixture) };
    }
    writeFileSync(join(configDir, 'reps-sources.json'), JSON.stringify(sources));
    writeFileSync(join(configDir, 'reps-district-aliases.json'), '{}');
    topo(join(publicDir, 'CO', 'enacted.topo.json'), usHouse);
    topo(join(publicDir, 'CO', 'state-senate', 'enacted.topo.json'), ['001', '012', '035']);
    topo(join(publicDir, 'CO', 'state-house', 'enacted.topo.json'), ['005', '007', '012', '030', '031']);
    return { configDir, cacheDir, publicDir, only: ['CO'] };
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reps-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the state file and coverage, filing reps under the enacted code', async () => {
    const input = setup();
    const { coverage } = await publishReps(input);
    expect(coverage.CO).toEqual({
      'state-senate': { matched: 2, unmatched: ['035'] },
      'state-house': { matched: 4, unmatched: ['031'] },
    });
    const file = StateRepsSchema.parse(JSON.parse(readFileSync(join(input.publicDir, 'reps', 'CO.json'), 'utf8')));
    expect(file.byKey['CO:us-house:03']?.[0]?.id).toBe('H001100');
    expect(file.byKey['CO:us-senate:state']).toHaveLength(1);
    expect(file.byKey['CO:us-senate:state']?.[0]?.districtCode).toBeNull();
    expect(Object.keys(file.byKey).filter((k) => k.includes('us-senate'))).toEqual(['CO:us-senate:state']);
    expect(file.byKey['CO:state-senate:012']?.[0]?.districtCode).toBe('012');
    expect(Object.keys(file.generatedFrom).sort()).toEqual(['co.csv', 'legislators-current.json', 'legislators-social-media.json']);
    expect(readFileSync(join(input.publicDir, 'reps', 'CO.json'), 'utf8')).not.toMatch(/party/i);
    expect(JSON.parse(readFileSync(join(input.publicDir, 'reps', 'coverage.json'), 'utf8'))).toEqual(coverage);
    // A run limited to some states must not replace the national map of websites.
    expect(existsSync(join(input.publicDir, 'reps', 'websites.json'))).toBe(false);
  });

  it('throws when a file differs from its pinned sha256', async () => {
    await expect(publishReps(setup({ 'co.csv': 'a'.repeat(64) }))).rejects.toThrow(/co\.csv: sha256/);
  });

  it('throws when the legislators file differs from its pinned sha256', async () => {
    await expect(publishReps(setup({ 'legislators-current.json': 'b'.repeat(64) }))).rejects.toThrow(/legislators-current\.json: sha256/);
  });

  it('publishes a House seat with no member as vacant and carries on', async () => {
    const input = setup({}, ['03', '04']);
    const { coverage } = await publishReps(input);
    expect(coverage.CO?.['us-house']).toEqual({ vacant: ['CO-04'] });
    const file = StateRepsSchema.parse(JSON.parse(readFileSync(join(input.publicDir, 'reps', 'CO.json'), 'utf8')));
    expect(file.byKey['CO:us-house:04']).toBeUndefined();
    expect(file.byKey['CO:us-house:03']).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(input.publicDir, 'reps', 'coverage.json'), 'utf8'))).toEqual(coverage);
  });

  it('records no vacancy when every House seat has a member', async () => {
    const { coverage } = await publishReps(setup());
    expect(coverage.CO?.['us-house']).toBeUndefined();
  });

  it('throws when an implausible number of House seats have no member', async () => {
    const codes = ['03', ...Array.from({ length: 16 }, (_, i) => String(i + 4).padStart(2, '0'))];
    await expect(publishReps(setup({}, codes))).rejects.toThrow(/16 U\.S\. House seats have no member/);
  });

  it('accepts exactly the most empty House seats allowed', async () => {
    const codes = ['03', ...Array.from({ length: 15 }, (_, i) => String(i + 4).padStart(2, '0'))];
    const { coverage } = await publishReps(setup({}, codes));
    expect(coverage.CO?.['us-house']?.vacant).toHaveLength(15);
  });

  it('throws when a state has no senators, and accepts one vacant Senate seat', async () => {
    const input = setup();
    const file = join(input.cacheDir, 'legislators-current.json');
    const members = JSON.parse(readFileSync(file, 'utf8')) as { terms: { type: string; state: string }[] }[];
    const without = (keep: (m: (typeof members)[number]) => boolean): void => {
      const text = JSON.stringify(members.filter(keep));
      writeFileSync(file, text);
      const path = join(input.configDir, 'reps-sources.json');
      const sources = JSON.parse(readFileSync(path, 'utf8')) as Record<string, { sha256: string }>;
      sources['legislators-current.json']!.sha256 = createHash('sha256').update(text).digest('hex');
      writeFileSync(path, JSON.stringify(sources));
    };
    const isSenator = (m: (typeof members)[number]): boolean => m.terms.at(-1)!.type === 'sen' && m.terms.at(-1)!.state === 'CO';
    await expect(publishReps(input)).resolves.toBeDefined();
    without((m) => !isSenator(m));
    await expect(publishReps(input)).rejects.toThrow(/no U\.S\. senator found for CO/);
  });
});
