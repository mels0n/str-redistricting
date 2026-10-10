import { describe, expect, it } from 'vitest';
import { isConnected } from '../../../src/server/entities/census-block/index.js';
import { createContext, splitState } from '../../../src/server/features/splitline/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';
import { gridBlocks } from '../../helpers/grid.js';
import { crossesNorthSouth, middleDeg } from '../../helpers/ranges.js';

const districtPops = (assignment: Int32Array, pops: number[], seats: number) => {
  const out = new Array<number>(seats).fill(0);
  assignment.forEach((d, i) => { out[d]! += pops[i]!; });
  return out;
};

describe('splitState', () => {
  it('draws 4 equal, connected districts on a uniform 4x4 grid in 3 cuts', () => {
    const blocks = gridBlocks(4, 4);
    const ctx = createContext(blocks);
    const r = splitState(ctx, 4);
    expect(r.cuts).toHaveLength(3);
    expect(districtPops(r.assignment, blocks.map((b) => b.pop), 4)).toEqual([4, 4, 4, 4]);
    for (let d = 0; d < 4; d++) {
      const members = Int32Array.from([...r.assignment.keys()].filter((i) => r.assignment[i] === d));
      expect(isConnected(ctx.topo, members)).toBe(true);
    }
  });
  it('handles an odd seat count', () => {
    const blocks = gridBlocks(3, 1);
    const r = splitState(createContext(blocks), 3);
    expect(districtPops(r.assignment, [1, 1, 1], 3)).toEqual([1, 1, 1]);
  });
  it('counts the candidate ranges each cut evaluated, over both orientations', () => {
    const even = splitState(createContext(gridBlocks(4, 4)), 4);
    for (const c of even.cuts) {
      expect(Number.isInteger(c.candidateRanges)).toBe(true);
      expect(c.candidateRanges).toBeGreaterThanOrEqual(2);
      expect(c.candidates.length).toBeLessThanOrEqual(c.candidateRanges);
      expect(c.splitChanges).toBeGreaterThan(0);
    }
    // Three seats split 1 + 2 either way round: the ranges of both orientations are candidates.
    const odd = splitState(createContext(gridBlocks(3, 1)), 3).cuts[0]!;
    expect(new Set(odd.candidates.map((c) => c.lowSeats))).toEqual(new Set([1, 2]));
    // A candidate is a range of directions: from before to, inside the half turn.
    for (const c of odd.candidates) {
      expect(c.fromDeg).toBeGreaterThanOrEqual(0);
      if (!crossesNorthSouth(c)) expect(c.fromDeg).toBeLessThan(c.toDeg);
      expect(c.toDeg).toBeLessThanOrEqual(180);
    }
  });
  it('records the winning range of each cut, drawn at its middle', () => {
    for (const c of splitState(createContext(gridBlocks(6, 5, { pop: (x, y) => 1 + ((x * 3 + y) % 4) })), 5).cuts) {
      expect(c.angleDeg).toBeCloseTo(middleDeg(c), 9);
      expect(c.candidates[0]).toMatchObject({ fromDeg: c.fromDeg, toDeg: c.toDeg, lowSeats: c.lowSeats, lengthM: c.lengthM });
    }
  });
  it('returns one district without cutting when seats = 1', () => {
    const r = splitState(createContext(gridBlocks(2, 2)), 1);
    expect(Array.from(r.assignment)).toEqual([0, 0, 0, 0]);
    expect(r.cuts).toHaveLength(0);
  });
});

describe('splitState numbering', () => {
  it('numbers districts depth-first, low side first, with none left unassigned', () => {
    // A row of equal blocks is cut across its length, so the low side is the low-x side at every level.
    for (const seats of [4, 8]) {
      const r = splitState(createContext(gridBlocks(seats, 1)), seats);
      expect(Array.from(r.assignment)).toEqual(Array.from({ length: seats }, (_, i) => i));
      expect(r.assignment.includes(-1)).toBe(false);
    }
  });
  it('leaves no district index of -1 on a 2D grid', () => {
    const r = splitState(createContext(gridBlocks(6, 5)), 5);
    expect(r.assignment.includes(-1)).toBe(false);
    expect(new Set(r.assignment).size).toBe(5);
  });
});

describe('createContext', () => {
  it('reports a block outside the projection hemisphere as a DataError', () => {
    const near = gridBlocks(1, 1)[0]!;
    const far = { ...near, geoid: '000000000000001', point: [170, 0] as const };
    const lonFar = { ...near, geoid: '000000000000002', point: [-170, 0] as const };
    expect(() => createContext([near, far, lonFar])).toThrow(DataError);
  });
});

describe('splitState cut ranges', () => {
  it('records the first district of each cut range in cut order', () => {
    const r = splitState(createContext(gridBlocks(5, 1)), 5);
    // 5 seats: first cut covers 0.., its low side covers 0.. and its high side starts at lowSeats.
    expect(r.cuts[0]!.firstDistrict).toBe(0);
    for (const c of r.cuts) {
      expect(c.lowSeats + c.highSeats).toBe(c.seats);
      expect(c.firstDistrict).toBeGreaterThanOrEqual(0);
      expect(c.firstDistrict + c.seats).toBeLessThanOrEqual(5);
    }
    const low = r.cuts.find((c) => c.depth === 1 && c.firstDistrict === 0)!;
    const high = r.cuts.find((c) => c.depth === 1 && c.firstDistrict === r.cuts[0]!.lowSeats)!;
    expect(low.seats).toBe(r.cuts[0]!.lowSeats);
    expect(high.seats).toBe(r.cuts[0]!.highSeats);
  });
  it('puts firstDistrict in cuts.geojson', async () => {
    const { cutsGeoJson } = await import('../../../src/server/features/export/index.js');
    const r = splitState(createContext(gridBlocks(4, 1)), 4);
    const fc = cutsGeoJson(r.cuts) as { features: { properties: Record<string, number> }[] };
    expect(fc.features.map((f) => f.properties.firstDistrict)).toEqual(r.cuts.map((c) => c.firstDistrict));
    expect(fc.features.map((f) => f.properties.firstDistrict)).toEqual([0, 0, 2]);
  });
});
