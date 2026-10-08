import { describe, expect, it } from 'vitest';
import { checkCoverage } from '../../../src/server/features/enacted/index.js';
import { STATES } from '../../../src/server/shared/apportionment/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';

describe('checkCoverage', () => {
  it('accepts an archive with districts for every state', () => {
    expect(() => checkCoverage(STATES.map((s) => s.fips), 'cb_2025_us_cd119_500k')).not.toThrow();
  });
  it('refuses an archive that lacks a state, naming it', () => {
    const fips = STATES.filter((s) => s.abbr !== 'WY').map((s) => s.fips);
    expect(() => checkCoverage(fips, 'cb_2025_us_cd119_500k')).toThrow(DataError);
    expect(() => checkCoverage(fips, 'cb_2025_us_cd119_500k')).toThrow(/no districts for WY/);
  });
});
