import { describe, expect, it } from 'vitest';
import { BlocksSchema } from '../../src/client/entities/plan';
import { lookupDistricts } from '../../src/client/pages/state/lookup';

const blocks = BlocksSchema.parse({
  v: 1,
  state: '08',
  seats: 8,
  fingerprints: { finished: 'a'.repeat(64), before: 'b'.repeat(64) },
  tracts: { '001007801': [6, 6, { '1002': [6, 7] }] },
});
const square = (district: number) => ({
  type: 'Feature' as const,
  properties: { district },
  geometry: { type: 'Polygon' as const, coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
});
const shapes = { finished: { features: [square(3)] }, before: { features: [square(4)] } };
const at = [5, 5] as const;

describe('lookupDistricts', () => {
  it('uses the block when it resolves, even if the point is in another simplified shape', () => {
    expect(lookupDistricts({ block: '080010078011002', blocks, shapes, at })).toEqual({ districts: { finished: 6, before: 7 }, exact: true });
  });
  it('falls back to the shapes without a block', () => {
    expect(lookupDistricts({ block: null, blocks, shapes, at })).toEqual({ districts: { finished: 3, before: 4 }, exact: false });
  });
  it('falls back when the blocks file did not load', () => {
    expect(lookupDistricts({ block: '080010078011002', blocks: null, shapes, at }).exact).toBe(false);
  });
  it('falls back for a block in another state or an unknown tract', () => {
    expect(lookupDistricts({ block: '060010078011002', blocks, shapes, at }).exact).toBe(false);
    expect(lookupDistricts({ block: '080019999991000', blocks, shapes, at }).exact).toBe(false);
  });
});
