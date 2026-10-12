import { describe, expect, it } from 'vitest';
import { stateByAbbr } from '../../../src/server/shared/apportionment/index.js';
import { CHAMBERS, parseChamber, planDir, seatsFor, stateForChamber } from '../../../src/server/shared/chamber/index.js';
import { LegislativeDistrictsSchema } from '../../../src/server/shared/config/index.js';
import { ConfigError, DataError } from '../../../src/server/shared/errors/index.js';

const CO = stateByAbbr('CO')!;
const NE = stateByAbbr('NE')!;
const table = { vintage: 2025, states: { NE: { 'state-house': 0, 'state-senate': 49 } } };

describe('chamber', () => {
  it('lists the three chambers and parses only those', () => {
    expect(CHAMBERS).toEqual(['federal-house', 'state-house', 'state-senate']);
    expect(parseChamber('state-house')).toBe('state-house');
    expect(() => parseChamber('senate')).toThrow(ConfigError);
  });
  it('keeps the Federal House in the state folder and puts the others below it', () => {
    expect(planDir('CO', 'federal-house')).toBe('CO');
    expect(planDir('CO', 'state-house')).toBe('CO/state-house');
    expect(planDir('CO', 'state-senate')).toBe('CO/state-senate');
  });
  it('counts federal seats without reading the table', () => {
    expect(seatsFor(CO, 'federal-house')).toBe(8);
    expect(stateForChamber(CO, 'federal-house')).toEqual(CO);
  });
  it('counts state chambers from the table, including a chamber that does not exist', () => {
    expect(seatsFor(NE, 'state-house', table)).toBe(0);
    expect(seatsFor(NE, 'state-senate', table)).toBe(49);
    expect(stateForChamber(NE, 'state-senate', table)).toEqual({ ...NE, seats: 49 });
  });
  it('refuses a state missing from the table', () => {
    expect(() => seatsFor(CO, 'state-house', table)).toThrow(DataError);
  });
  it('validates the table shape', () => {
    expect(LegislativeDistrictsSchema.safeParse(table).success).toBe(true);
    expect(LegislativeDistrictsSchema.safeParse({ vintage: 2025, states: { NE: { 'state-house': -1, 'state-senate': 49 } } }).success).toBe(false);
    expect(LegislativeDistrictsSchema.safeParse({ vintage: 2025, states: { NE: { 'state-senate': 49 } } }).success).toBe(false);
  });
});
