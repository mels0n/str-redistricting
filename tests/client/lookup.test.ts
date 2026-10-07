import { describe, expect, it, vi } from 'vitest';
import { BlocksSchema } from '../../src/client/entities/plan';
import { exactSelection, finishWhenLoaded, lookupDistricts } from '../../src/client/pages/state/lookup';

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

describe('finishWhenLoaded', () => {
  const mk = (alive: boolean) => ({ alive: () => alive, setBlocks: vi.fn(), finish: vi.fn(() => 'done'), fallback: 'Found X.' });
  it('sets blocks and finishes when the page is alive', async () => {
    const o = mk(true);
    expect(await finishWhenLoaded(Promise.resolve(blocks), o)).toBe('done');
    expect(o.setBlocks).toHaveBeenCalledWith(blocks);
  });
  it('still finishes when the load fails', async () => {
    const o = mk(true);
    expect(await finishWhenLoaded(Promise.reject(new Error('x')), o)).toBe('done');
    expect(o.setBlocks).toHaveBeenCalledWith(null);
  });
  it('does nothing when the page was destroyed before the load settled', async () => {
    for (const load of [Promise.resolve(blocks), Promise.reject(new Error('x'))]) {
      const o = mk(false);
      expect(await finishWhenLoaded(load, o)).toBe('Found X.');
      expect(o.finish).not.toHaveBeenCalled();
      expect(o.setBlocks).not.toHaveBeenCalled();
    }
  });
});

describe('exactSelection', () => {
  it('selects the exact district when the route still holds the shape answer', () => {
    expect(exactSelection({ before: 3, after: 6, selected: 3 })).toBe(6);
  });
  it('selects the exact district when the shapes found none and nothing is selected', () => {
    expect(exactSelection({ before: null, after: 6, selected: null })).toBe(6);
  });
  it('keeps a district the visitor picked meanwhile', () => {
    expect(exactSelection({ before: 3, after: 6, selected: 2 })).toBeNull();
  });
  it('does not navigate when the exact answer equals the shape answer', () => {
    expect(exactSelection({ before: 3, after: 3, selected: 3 })).toBeNull();
  });
  it('does not navigate when there is no exact answer', () => {
    expect(exactSelection({ before: 3, after: null, selected: 3 })).toBeNull();
  });
});
