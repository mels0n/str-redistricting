import { describe, expect, it } from 'vitest';
import { STATES, stateByAbbr } from '../../../src/server/shared/apportionment/index.js';

describe('2020 apportionment', () => {
  it('has 50 states and 435 seats', () => {
    expect(STATES).toHaveLength(50);
    expect(STATES.reduce((s, x) => s + x.seats, 0)).toBe(435);
  });
  it('lists every state once, with at least one seat each', () => {
    const abbrs = STATES.map((s) => s.abbr);
    expect(new Set(abbrs).size).toBe(50);
    expect([...abbrs].sort()).toEqual('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ').sort());
    expect(STATES.every((s) => s.seats >= 1)).toBe(true);
  });
  it('knows the pilot states', () => {
    expect(stateByAbbr('CO')).toMatchObject({ fips: '08', seats: 8 });
    expect(stateByAbbr('MD')).toMatchObject({ fips: '24', seats: 8 });
    expect(stateByAbbr('TX')).toMatchObject({ fips: '48', seats: 38 });
    expect(stateByAbbr('NC')).toMatchObject({ fips: '37', seats: 14 });
    expect(stateByAbbr('RI')).toMatchObject({ fips: '44', seats: 2 });
  });
});
