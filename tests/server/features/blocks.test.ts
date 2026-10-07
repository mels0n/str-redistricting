import { describe, expect, it } from 'vitest';
import { checkBlocks, encodeBlocks, type BlocksFile } from '../../../src/server/features/publish/index.js';
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

const exp = { state: '08', seats: 8 };

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
  it('rejects a district that is not an integer in 1..seats', () => {
    for (const bad of ['0', '9', '1.5', '1e1', '-1', '', ' ', '0x2']) {
      const c = csv([['080010078011000', 1]]).replace(',1', `,${bad}`);
      expect(() => encodeBlocks('08', 8, c, c)).toThrow(DataError);
    }
    const ok = csv([['080010078011000', 8]]);
    expect(() => encodeBlocks('08', 8, ok, ok)).not.toThrow();
  });
});

describe('checkBlocks', () => {
  it('passes on its own output', () => {
    expect(() => checkBlocks(encodeBlocks('08', 8, finished, before), finished, before, exp)).not.toThrow();
  });
  it('names the first mismatching block', () => {
    const file = encodeBlocks('08', 8, finished, before);
    const altered = before.replace('080010078011002,7', '080010078011002,5');
    expect(() => checkBlocks(file, finished, altered, exp)).toThrow(/080010078011002/);
    expect(() => checkBlocks(file, finished, altered, exp)).toThrow(DataError);
  });
  it('throws when a block is missing from a CSV or the CSVs differ', () => {
    const file = encodeBlocks('08', 8, finished, before);
    expect(() => checkBlocks(file, finished, csv([['080010078011000', 6]]), exp)).toThrow(DataError);
    expect(() => checkBlocks(file, finished, before.replace('080010078022001', '080010078022009'), exp)).toThrow(DataError);
  });
  it('fails when the file holds a tract or block exception the CSVs lack', () => {
    const file = encodeBlocks('08', 8, finished, before);
    const extraTract = { ...file, tracts: { ...file.tracts, '009999999': [1, 1] as [number, number] } };
    expect(() => checkBlocks(extraTract, finished, before, exp)).toThrow(/009999999/);
    const t = file.tracts['001007801']!;
    const extraBlock = { ...file, tracts: { ...file.tracts, '001007801': [t[0], t[1], { ...(t[2] ?? {}), '9999': [1, 1] }] as BlocksFile['tracts'][string] } };
    expect(() => checkBlocks(extraBlock, finished, before, exp)).toThrow(/9999/);
  });
  it('fails when the file state or seats disagree with the arguments', () => {
    const file = encodeBlocks('08', 8, finished, before);
    expect(() => checkBlocks(file, finished, before, { state: '09', seats: 8 })).toThrow(DataError);
    expect(() => checkBlocks(file, finished, before, { state: '08', seats: 7 })).toThrow(DataError);
    expect(() => checkBlocks({ ...file, seats: 9 }, finished, before, exp)).toThrow(DataError);
  });
});
