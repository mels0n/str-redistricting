import { describe, expect, it } from 'vitest';
import { STATES, stateByAbbr } from '../../../src/server/shared/apportionment/index.js';

describe('2020 apportionment', () => {
  it('has 50 states and 435 seats', () => {
    expect(STATES).toHaveLength(50);
    expect(STATES.reduce((s, x) => s + x.seats, 0)).toBe(435);
  });
  it('knows the pilot states', () => {
    expect(stateByAbbr('CO')).toMatchObject({ fips: '08', seats: 8 });
    expect(stateByAbbr('MD')).toMatchObject({ fips: '24', seats: 8 });
    expect(stateByAbbr('TX')).toMatchObject({ fips: '48', seats: 38 });
    expect(stateByAbbr('NC')).toMatchObject({ fips: '37', seats: 14 });
    expect(stateByAbbr('RI')).toMatchObject({ fips: '44', seats: 2 });
  });
});
