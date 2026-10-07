import { describe, expect, it } from 'vitest';
import { checkBlocks, encodeBlocks } from '../../../src/server/features/publish/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';

const csv = (rows: [string, number][]): string => ['GEOID20,district', ...rows.map(([g, d]) => `${g},${d}`)].join('\n') + '\n';

const finished = csv([
  ['080010078011000', 6], ['080010078011001', 6], ['080010078011002', 6],
  ['080010078022000', 5], ['080010078022001', 5],
]);
const before = csv([
  ['080010078011000', 6], ['080010078011001', 6], ['080010078011002', 7],
  ['080010078022000', 5], ['080010078022001', 5],
]);

describe('encodeBlocks', () => {
  it('stores each tract as its most common pair plus the blocks that differ', () => {
    const f = encodeBlocks('08', 8, finished, before);
    expect(f.v).toBe(1);
    expect(f.state).toBe('08');
    expect(f.seats).toBe(8);
    expect(f.tracts['001007801']).toEqual([6, 6, { '1002': [6, 7] }]);
    expect(f.tracts['001007802']).toEqual([5, 5]);
  });
  it('breaks a tie in the most common pair by the smaller pair', () => {
    const a = csv([['080010078011000', 2], ['080010078011001', 1]]);
    const f = encodeBlocks('08', 8, a, a);
    expect(f.tracts['001007801']![0]).toBe(1);
    expect(f.tracts['001007801']![1]).toBe(1);
    expect(f.tracts['001007801']![2]).toEqual({ '1000': [2, 2] });
  });
  it('rejects malformed rows and mismatched GEOID lists', () => {
    expect(() => encodeBlocks('08', 8, 'GEOID20,district\n0800100780110,1\n', 'GEOID20,district\n0800100780110,1\n')).toThrow(DataError);
    expect(() => encodeBlocks('08', 8, finished, csv([['080010078011000', 6]]))).toThrow(DataError);
    expect(() => encodeBlocks('08', 8, finished, finished.replace('080010078022001', '080010078022009'))).toThrow(DataError);
  });
});

describe('checkBlocks', () => {
  it('passes on its own output', () => {
    expect(() => checkBlocks(encodeBlocks('08', 8, finished, before), finished, before)).not.toThrow();
  });
  it('names the first mismatching block', () => {
    const file = encodeBlocks('08', 8, finished, before);
    const altered = before.replace('080010078011002,7', '080010078011002,5');
    expect(() => checkBlocks(file, finished, altered)).toThrow(/080010078011002/);
    expect(() => checkBlocks(file, finished, altered)).toThrow(DataError);
  });
  it('throws when a block is missing from a CSV or the CSVs differ', () => {
    const file = encodeBlocks('08', 8, finished, before);
    expect(() => checkBlocks(file, finished, csv([['080010078011000', 6]]))).toThrow(DataError);
    expect(() => checkBlocks(file, finished, before.replace('080010078022001', '080010078022009'))).toThrow(DataError);
  });
});
