// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlocksSchema, districtsForBlock, loadBlocks } from '../../src/client/entities/plan';

const file = {
  v: 1,
  state: '08',
  seats: 8,
  fingerprints: { finished: 'a'.repeat(64), before: 'b'.repeat(64) },
  tracts: { '001007801': [6, 6, { '1002': [6, 7] }], '001007802': [5, 5] },
};
const blocks = BlocksSchema.parse(file);

describe('districtsForBlock', () => {
  it('reads the tract pair and per-block exceptions', () => {
    expect(districtsForBlock(blocks, '080010078011002')).toEqual({ finished: 6, before: 7 });
    expect(districtsForBlock(blocks, '080010078011000')).toEqual({ finished: 6, before: 6 });
    expect(districtsForBlock(blocks, '080010078022001')).toEqual({ finished: 5, before: 5 });
  });
  it('returns null for another state, a short id, or an unknown tract', () => {
    expect(districtsForBlock(blocks, '060010078011000')).toBeNull();
    expect(districtsForBlock(blocks, '08001999999')).toBeNull();
    expect(districtsForBlock(blocks, '080019999991000')).toBeNull();
  });
});

describe('BlocksSchema', () => {
  it('rejects v 2, district 0 and a district above seats', () => {
    expect(BlocksSchema.safeParse({ ...file, v: 2 }).success).toBe(false);
    expect(BlocksSchema.safeParse({ ...file, fingerprints: undefined }).success).toBe(false);
    expect(BlocksSchema.safeParse({ ...file, fingerprints: { finished: 'x', before: 'b'.repeat(64) } }).success).toBe(false);
    expect(BlocksSchema.safeParse({ ...file, tracts: { a: [0, 1] } }).success).toBe(false);
    expect(BlocksSchema.safeParse({ ...file, tracts: { a: [1, 9] } }).success).toBe(false);
    expect(BlocksSchema.safeParse({ ...file, tracts: { a: [1, 1, { '1000': [9, 1] }] } }).success).toBe(false);
  });
});

describe('loadBlocks', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('caches a success per state and does not cache a failure', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}), text: async () => '' })
      .mockResolvedValue({ ok: true, status: 200, json: async () => file, text: async () => JSON.stringify(file) });
    vi.stubGlobal('fetch', f);
    await expect(loadBlocks('ZZ')).rejects.toBeDefined();
    const a = await loadBlocks('ZZ');
    const b = await loadBlocks('ZZ');
    expect(a).toBe(b);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
