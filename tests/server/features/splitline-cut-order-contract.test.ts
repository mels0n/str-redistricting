import { describe, expect, it } from 'vitest';
import { createContext, splitState } from '../../../src/server/features/splitline/index.js';
import { cutsGeoJson } from '../../../src/server/features/export/write.js';
import { cutSides, piecesAfter, type Cut } from '../../../src/client/entities/plan/index.js';
import { gridBlocks } from '../../helpers/grid.js';

type Records = ReturnType<typeof splitState>['cuts'];

/** The cuts as the viewer reads them: through the writer the published files come from (order = index + 1). */
function viewerCuts(records: Records): Cut[] {
  const fc = cutsGeoJson(records) as { features: { properties: Record<string, number> }[] };
  return fc.features.map((f, i) => ({ ...f.properties, lengthM: records[i]!.lengthM, lines: [] }) as unknown as Cut);
}

/**
 * The truth the viewer must reproduce, taken from the engine's own cuts and the final districts, not from the viewer's
 * inference: a cut's range holds the cuts nested inside it, and its two halves are the districts of the biggest nested
 * piece that starts at the range's first district and the rest of the range.
 */
function halves(records: Records, i: number): { lower: number[]; upper: number[] } {
  const c = records[i]!;
  const end = c.firstDistrict + c.seats;
  // The first later cut that starts at the same district is the one splitting the lower half; none means a single district.
  const child = records.slice(i + 1).find((o) => o.firstDistrict === c.firstDistrict && o.firstDistrict + o.seats <= end);
  const lowerSize = child ? child.seats : 1;
  const range = (a: number, b: number): number[] => Array.from({ length: b - a }, (_, n) => a + n);
  return { lower: range(c.firstDistrict, c.firstDistrict + lowerSize), upper: range(c.firstDistrict + lowerSize, end) };
}

const grids = [
  ['1x3, 3 seats', gridBlocks(1, 3), 3],
  ['1x4, 2 seats', gridBlocks(1, 4), 2],
  ['2x10, 5 seats, 2-seat side holds block 0', gridBlocks(2, 10, { pop: (_x, y) => 1 + y }), 5],
  ['3x5, 5 seats', gridBlocks(3, 5, { pop: (x, y) => 1 + ((x * 3 + y * 5) % 4) }), 5],
  ['5x3, 5 seats', gridBlocks(5, 3, { pop: (x, y) => 1 + ((x * 3 + y * 5) % 4) }), 5],
  ['4x4, 5 seats', gridBlocks(4, 4, { pop: (x, y) => 1 + ((x * 3 + y * 5) % 4) }), 5],
  ['6x5, 7 seats', gridBlocks(6, 5, { pop: (x, y) => 1 + ((x * 3 + y * 5) % 4) }), 7],
] as const;

describe('the engine cut order against the viewer numbering', () => {
  it('has a root that gives 3 seats to the line side while block 0 is on the 2-seat side', () => {
    const r = splitState(createContext(gridBlocks(2, 10, { pop: (_x, y) => 1 + y })), 5);
    expect(r.cuts[0]).toMatchObject({ lowSeats: 3, highSeats: 2 });
    expect(r.assignment[0]).toBeLessThan(2);
  });

  for (const [name, blocks, seats] of grids) {
    describe(name, () => {
      const r = splitState(createContext(blocks), seats);
      const cuts = viewerCuts(r.cuts);

      it('groups districts after k cuts as the final assignment implies', () => {
        expect(cuts).toHaveLength(seats - 1);
        // Two districts share a piece after k cuts iff no cut among the first k separates them.
        const separated = (k: number, d: number, e: number): boolean => {
          for (let i = 0; i < k; i++) {
            const { lower, upper } = halves(r.cuts, i);
            if ((lower.includes(d) && upper.includes(e)) || (lower.includes(e) && upper.includes(d))) return true;
          }
          return false;
        };
        for (let k = 0; k <= cuts.length; k++) {
          const piece = piecesAfter(cuts, k, seats);
          for (let d = 0; d < seats; d++) {
            for (let e = d + 1; e < seats; e++) expect(piece[d] === piece[e], `k=${k} districts ${d + 1},${e + 1}`).toBe(!separated(k, d, e));
          }
        }
      });

      it('gives every cut the low and high district ranges of its real sides', () => {
        cuts.forEach((c, i) => {
          const { lower, upper } = halves(r.cuts, i);
          // The line's low side holds lowSeats districts, so it is whichever numbered half has that many.
          const lowIsLower = lower.length === c.lowSeats;
          const [low, high] = lowIsLower ? [lower, upper] : [upper, lower];
          expect(low).toHaveLength(c.lowSeats);
          expect(high).toHaveLength(c.highSeats);
          const sides = cutSides(c, cuts);
          expect(sides.low).toEqual([low[0]! + 1, low[low.length - 1]! + 1]);
          expect(sides.high).toEqual([high[0]! + 1, high[high.length - 1]! + 1]);
        });
      });
    });
  }
});
