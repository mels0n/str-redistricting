import { describe, expect, it } from 'vitest';
import { createContext, splitState } from '../../../src/server/features/splitline/index.js';
import { gridBlocks } from '../../helpers/grid.js';

// Grid rows run south to north, so block 0 is the south-west corner: a line across a column reaches the north side
// first, and block 0 is on the other side.
describe('district numbering', () => {
  it('gives district 0 to the side holding block 0 when 2 seats are split', () => {
    const r = splitState(createContext(gridBlocks(1, 4)), 2);
    expect(r.assignment[0]).toBe(0);
    expect(r.cuts[0]!.firstDistrict).toBe(0);
  });

  it('numbers the side holding block 0 first even when it holds more seats', () => {
    const r = splitState(createContext(gridBlocks(1, 3)), 3);
    const cut = r.cuts[0]!;
    // The line reaches the north side first and gives it 1 seat, so block 0 lies on the 2-seat side ({0, 1} below
    // the line): it is district 0, and the 1-seat side is district 2.
    expect(cut.lowSeats).toBe(1);
    expect(Array.from(r.assignment)).toEqual([0, 1, 2]);
    expect(cut.firstDistrict).toBe(0);
    expect(r.cuts[1]!.firstDistrict).toBe(0);
  });

  it('numbers the smaller side first when it holds block 0 and is the second side of the line', () => {
    // People grow northward, so the first cut is an east-west line whose first (north) side gets the 3-seat share
    // and leaves the 2-seat share on the south side, with block 0.
    const r = splitState(createContext(gridBlocks(2, 10, { pop: (_x, y) => 1 + y })), 5);
    const root = r.cuts[0]!;
    expect(root.lowSeats).toBe(3);
    expect(root.highSeats).toBe(2);
    expect(r.assignment[0]).toBe(0);
    expect(new Set(r.assignment)).toEqual(new Set([0, 1, 2, 3, 4]));
    // The 2-seat south side is districts 0 and 1: the next cut splits it, and the north side starts at district 2.
    expect(r.cuts[1]).toMatchObject({ firstDistrict: 0, seats: 2 });
    expect(r.cuts.find((c) => c.depth === 1 && c.firstDistrict === 2)!.seats).toBe(3);
  });

  it('keeps district ids 0..N-1 and starts every cut range at its lowest block, nested', () => {
    for (const [w, h] of [[3, 5], [5, 3], [4, 4], [6, 5]] as const) {
      const blocks = gridBlocks(w, h, { pop: (x, y) => 1 + ((x * 3 + y * 5) % 4) });
      const r = splitState(createContext(blocks), 5);
      expect(new Set(r.assignment)).toEqual(new Set([0, 1, 2, 3, 4]));
      expect(r.cuts).toHaveLength(4);
      for (const c of r.cuts) {
        let min = Infinity;
        r.assignment.forEach((d, i) => { if (d >= c.firstDistrict && d < c.firstDistrict + c.seats && i < min) min = i; });
        expect(r.assignment[min]).toBe(c.firstDistrict);
      }
    }
  });
});
