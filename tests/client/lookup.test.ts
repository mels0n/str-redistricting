import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlocksSchema } from '../../src/client/entities/plan';
import { afterArrivalLoad, exactSelection, finishWhenLoaded, lookupDistricts } from '../../src/client/pages/state/lookup';

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
const fingerprints = { finished: 'a'.repeat(64), before: 'b'.repeat(64) };

describe('lookupDistricts', () => {
  it('uses the block when it resolves, even if the point is in another simplified shape', () => {
    expect(lookupDistricts({ block: '080010078011002', blocks, fingerprints, shapes, at })).toEqual({ districts: { finished: 6, before: 7 }, exact: true });
  });
  it('falls back to the shapes without a block', () => {
    expect(lookupDistricts({ block: null, blocks, fingerprints, shapes, at })).toEqual({ districts: { finished: 3, before: 4 }, exact: false });
  });
  it('falls back when the blocks file did not load', () => {
    expect(lookupDistricts({ block: '080010078011002', blocks: null, fingerprints, shapes, at }).exact).toBe(false);
  });
  it('falls back when the blocks were built from a different finished or before plan than the one drawn', () => {
    const block = '080010078011002';
    expect(lookupDistricts({ block, blocks, fingerprints: { ...fingerprints, finished: 'c'.repeat(64) }, shapes, at })).toEqual({ districts: { finished: 3, before: 4 }, exact: false });
    expect(lookupDistricts({ block, blocks, fingerprints: { ...fingerprints, before: 'c'.repeat(64) }, shapes, at }).exact).toBe(false);
  });
  it('falls back for a block in another state or an unknown tract', () => {
    expect(lookupDistricts({ block: '060010078011002', blocks, fingerprints, shapes, at }).exact).toBe(false);
    expect(lookupDistricts({ block: '080019999991000', blocks, fingerprints, shapes, at }).exact).toBe(false);
  });
});

afterEach(() => {
  vi.useRealTimers();
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

describe('finishWhenLoaded with a stalled load', () => {
  it('finishes with the shape answer after the wait, and a late arrival changes nothing', async () => {
    vi.useFakeTimers();
    let arrive: (b: typeof blocks) => void = () => undefined;
    const load = new Promise<typeof blocks>((r) => {
      arrive = r;
    });
    const o = { alive: () => true, setBlocks: vi.fn(), finish: vi.fn(() => 'done'), fallback: 'Found X.', waitMs: 4000 };
    const result = finishWhenLoaded(load, o);
    await vi.advanceTimersByTimeAsync(3999);
    expect(o.finish).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe('done');
    expect(o.setBlocks).toHaveBeenCalledTimes(1);
    expect(o.setBlocks).toHaveBeenCalledWith(null);
    arrive(blocks);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(o.setBlocks).toHaveBeenCalledTimes(1);
    expect(o.finish).toHaveBeenCalledTimes(1);
  });
  it('does not wait out the timer when the load is quick', async () => {
    vi.useFakeTimers();
    const o = { alive: () => true, setBlocks: vi.fn(), finish: vi.fn(() => 'done'), fallback: 'Found X.' };
    expect(await finishWhenLoaded(Promise.resolve(blocks), o)).toBe('done');
    expect(o.setBlocks).toHaveBeenCalledWith(blocks);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('afterArrivalLoad', () => {
  const mk = (over: Partial<Parameters<typeof afterArrivalLoad>[0]> = {}) => ({
    load: Promise.resolve(blocks) as Promise<typeof blocks | null>,
    alive: () => true,
    setBlocks: vi.fn(),
    relocate: vi.fn((): number | null => 6),
    before: 3 as number | null,
    selected: () => 3 as number | null,
    ...over,
  });
  it('does nothing when the page was destroyed', async () => {
    const o = mk({ alive: () => false });
    expect(await afterArrivalLoad(o)).toBeNull();
    expect(o.setBlocks).not.toHaveBeenCalled();
    expect(o.relocate).not.toHaveBeenCalled();
  });
  it('keeps the shape answer when the load fails', async () => {
    const o = mk({ load: Promise.reject(new Error('x')) });
    expect(await afterArrivalLoad(o)).toBeNull();
    expect(o.setBlocks).not.toHaveBeenCalled();
    expect(o.relocate).not.toHaveBeenCalled();
  });
  it('selects the exact district when it differs and the selection is untouched', async () => {
    const o = mk();
    expect(await afterArrivalLoad(o)).toBe(6);
    expect(o.setBlocks).toHaveBeenCalledWith(blocks);
    expect(o.relocate).toHaveBeenCalledTimes(1);
  });
  it('only redraws when the visitor changed the selection meanwhile', async () => {
    expect(await afterArrivalLoad(mk({ selected: () => 2 }))).toBe('render');
  });
  it('only redraws when the exact district equals the shape answer', async () => {
    expect(await afterArrivalLoad(mk({ relocate: () => 3 }))).toBe('render');
  });
  it('reads the selection after the load, not before', async () => {
    let current: number | null = 3;
    let release: (b: typeof blocks) => void = () => undefined;
    const load = new Promise<typeof blocks>((r) => {
      release = r;
    });
    const result = afterArrivalLoad(mk({ load, selected: () => current }));
    current = 2;
    release(blocks);
    expect(await result).toBe('render');
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
