import { describe, expect, it, vi } from 'vitest';
import type { Feature, Polygon } from 'geojson';

const square = (x: number, code: string): Feature<Polygon, { label: string; code: string }> => ({
  type: 'Feature',
  properties: { label: code, code },
  geometry: { type: 'Polygon', coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] },
});

vi.mock('../../src/client/entities/plan', () => ({
  loadEnacted: async (_state: string, chamber: string) => {
    if (chamber === 'federal-house') return { lines: null, features: [square(0, '01'), square(1, '02')] };
    if (chamber === 'state-senate') return { lines: null, features: [square(0, '02'), square(0, '01')] };
    throw new Error('missing');
  },
}));

import { repsFor, todaysDistrictsAt } from '../../src/client/features/todays-districts';
import type { StateReps } from '../../src/client/entities/reps';

const rep = (id: string, office: 'us-senate' | 'us-house') => ({
  id, name: id, office, districtCode: null, contactUrl: null, email: null, phone: null, address: null, website: null, social: {},
});
const reps: StateReps = {
  state: 'CO',
  generatedFrom: {},
  byKey: { 'CO:us-senate:state': [rep('S1', 'us-senate'), rep('S2', 'us-senate')], 'CO:us-house:02': [rep('H2', 'us-house')] },
};

describe('todaysDistrictsAt', () => {
  it('finds the polygon that holds the point', async () => {
    const d = await todaysDistrictsAt('CO', [1.5, 0.5]);
    expect(d.usHouse).toBe('02');
    expect(d.stateHouse).toBeNull();
  });
  it('gives null outside every district', async () => {
    expect((await todaysDistrictsAt('CO', [5, 5])).usHouse).toBeNull();
  });
  it('lets the lowest code win when shapes overlap', async () => {
    expect((await todaysDistrictsAt('CO', [0.5, 0.5])).stateSenate).toBe('01');
  });
});

describe('repsFor', () => {
  it('flags a district with no entry and still lists the US Senate', () => {
    const rows = repsFor(reps, { state: 'CO', usHouse: '02', stateHouse: '999', stateSenate: null });
    expect(rows.map((r) => r.office)).toEqual(['state-house', 'us-house', 'us-senate']);
    expect(rows[0]).toMatchObject({ key: 'CO:state-house:999', missing: true });
    expect(rows[1]).toMatchObject({ missing: false });
    expect(rows[2]!.reps).toHaveLength(2);
  });
});
