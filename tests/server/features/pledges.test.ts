import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PledgeSchema, PledgesFileSchema, readPledgesFile } from '../../../src/server/features/pledges/index.js';

const ok = {
  id: 'jane-doe-co-03',
  name: 'Jane Doe',
  role: 'incumbent',
  personId: 'D000001',
  office: 'us-house',
  state: 'CO',
  districtCode: '03',
  statementUrl: 'https://example.org/statement',
  campaignUrl: null,
  pledgedOn: '2026-10-01',
  cycle: null,
};
const file = (...pledges: unknown[]) => ({ pledges });

describe('PledgeSchema', () => {
  it('accepts a complete pledge, and a Senate pledge with no district', () => {
    expect(PledgeSchema.safeParse(ok).success).toBe(true);
    expect(PledgeSchema.safeParse({ ...ok, id: 'sen', office: 'us-senate', districtCode: null }).success).toBe(true);
  });

  it.each([
    ['an http statement URL', { ...ok, statementUrl: 'http://example.org/s' }],
    ['an incumbent without personId', { ...ok, personId: null }],
    ['a party key', { ...ok, party: 'X' }],
    ['a non-kebab id', { ...ok, id: 'Jane Doe' }],
    ['a null district outside the U.S. Senate', { ...ok, districtCode: null }],
    ['an impossible date', { ...ok, pledgedOn: '2026-13-45' }],
  ])('rejects %s', (_name, value) => {
    expect(PledgeSchema.safeParse(value).success).toBe(false);
  });

  it('rejects duplicate ids in a file', () => {
    expect(PledgesFileSchema.safeParse(file(ok, { ...ok })).success).toBe(false);
    expect(PledgesFileSchema.safeParse(file(ok, { ...ok, id: 'other' })).success).toBe(true);
  });
});

describe('readPledgesFile', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pledges-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads a valid file and fails on an invalid or unreadable one', () => {
    const path = join(dir, 'p.json');
    writeFileSync(path, JSON.stringify(file(ok)));
    expect(readPledgesFile(path).pledges).toHaveLength(1);
    writeFileSync(path, JSON.stringify(file({ ...ok, statementUrl: 'http://x.org/' })));
    expect(() => readPledgesFile(path)).toThrow(/statementUrl/);
    writeFileSync(path, 'not json');
    expect(() => readPledgesFile(path)).toThrow(/not readable/);
    expect(() => readPledgesFile(join(dir, 'missing.json'))).toThrow();
  });

  it('accepts the committed config/pledges.json', () => {
    expect(() => readPledgesFile('config/pledges.json')).not.toThrow();
  });
});
