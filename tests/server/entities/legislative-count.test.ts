import { describe, expect, it } from 'vitest';
import { countDistricts, isLegislativeFile, legislativeFileName, legislativeUrl, isAbsentUpstream } from '../../../src/server/entities/legislative-boundary/index.js';
import { STATES } from '../../../src/server/shared/apportionment/index.js';
import { LegislativeDistrictsSchema } from '../../../src/server/shared/config/index.js';
import { DownloadError } from '../../../src/server/shared/errors/index.js';

const CO = STATES.find((s) => s.abbr === 'CO')!;

describe('countDistricts', () => {
  it('counts distinct House codes and skips only ZZZ', () => {
    expect(countDistricts([{ SLDLST: '001' }, { SLDLST: '002' }, { SLDLST: '002' }, { SLDLST: 'ZZZ' }], 'state-house')).toBe(2);
  });
  it('reads SLDUST for the Senate and ignores the other field', () => {
    expect(countDistricts([{ SLDUST: '01', SLDLST: '001' }, { SLDUST: '02' }, { SLDUST: 'ZZZ' }], 'state-senate')).toBe(2);
  });
  it('does not special-case any code but ZZZ', () => {
    expect(countDistricts([{ SLDLST: '001' }, { SLDLST: '00A' }, { SLDLST: '000' }], 'state-house')).toBe(3);
  });
});

describe('file names and addresses', () => {
  it('names the House file sldl and the Senate file sldu', () => {
    expect(legislativeFileName(CO, 'state-house', 2025)).toBe('cb_2025_08_sldl_500k');
    expect(legislativeFileName(CO, 'state-senate', 2025)).toBe('cb_2025_08_sldu_500k');
  });
  it('serves them from the vintage folder', () => {
    expect(legislativeUrl('cb_2025_08_sldl_500k')).toBe('https://www2.census.gov/geo/tiger/GENZ2025/shp/cb_2025_08_sldl_500k.zip');
  });
  it('recognises only legislative names', () => {
    expect(isLegislativeFile('cb_2025_08_sldu_500k.zip')).toBe(true);
    expect(isLegislativeFile('cb_2025_us_cd119_500k.zip')).toBe(false);
  });
});

describe('isAbsentUpstream', () => {
  it('is true only for a 404', async () => {
    expect(await isAbsentUpstream('u', () => Promise.reject(new DownloadError('x', 404)))).toBe(true);
    expect(await isAbsentUpstream('u', () => Promise.resolve({}))).toBe(false);
    await expect(isAbsentUpstream('u', () => Promise.reject(new DownloadError('x', 500)))).rejects.toThrow();
  });
});

describe('LegislativeDistrictsSchema', () => {
  it('rejects a negative count and a missing chamber', () => {
    expect(LegislativeDistrictsSchema.safeParse({ vintage: 2025, states: { CO: { 'state-house': -1, 'state-senate': 35 } } }).success).toBe(false);
    expect(LegislativeDistrictsSchema.safeParse({ vintage: 2025, states: { CO: { 'state-house': 65 } } }).success).toBe(false);
    expect(LegislativeDistrictsSchema.safeParse({ vintage: 2025, states: { NE: { 'state-house': 0, 'state-senate': 49 } } }).success).toBe(true);
  });
});
