import { describe, expect, it } from 'vitest';
import { checkCoverage } from '../../../src/server/features/enacted/index.js';
import { STATES } from '../../../src/server/shared/apportionment/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';

const feature = (stateFp: string) => ({ properties: { STATEFP: stateFp, NAMELSAD: 'District 1', CD119FP: '01' }, geometry: null });

describe('checkCoverage', () => {
  it('accepts a feature list with districts for every state', () => {
    expect(() => checkCoverage(STATES.map((s) => feature(s.fips)), 'cb_2025_us_cd119_500k')).not.toThrow();
  });
  it('refuses an archive that lacks a state, naming it', () => {
    const features = STATES.filter((s) => s.abbr !== 'WY').map((s) => feature(s.fips));
    expect(() => checkCoverage(features, 'cb_2025_us_cd119_500k')).toThrow(DataError);
    expect(() => checkCoverage(features, 'cb_2025_us_cd119_500k')).toThrow(/no districts for WY/);
  });
});
