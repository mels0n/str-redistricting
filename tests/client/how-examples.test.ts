// @vitest-environment jsdom
// The cross-check below imports the generator's cut code, which needs its module declarations.
/// <reference path="../../src/server/entities/census-block/shapefile.d.ts" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectLow } from '../../src/server/features/splitline/cut';
import {
  BALANCE_EXAMPLE,
  DIRECTION_EXAMPLE,
  SPLIT_EXAMPLE,
  applyTrade,
  bestTrade,
  furthest,
  improvement,
  sumOfSquares,
  walkSplit,
  type Trade,
} from '../../src/client/pages/how/examples';
import { balanceChoiceDiagram, directionLengths, signed } from '../../src/client/pages/how/diagrams';
import { createHowPage } from '../../src/client/pages/how';

const { start, trades } = BALANCE_EXAMPLE;
const trade = (id: string): Trade => trades.find((t) => t.id === id)!;

describe('balancing worked example', () => {
  it('starts 400 over, 300 under and 100 under, a sum of squares of 260,000', () => {
    expect(start).toEqual({ 1: -300, 3: 400, 5: -100 });
    expect(Object.values(start).reduce((s, d) => s + d, 0)).toBe(0);
    expect(sumOfSquares(start)).toBe(160_000 + 90_000 + 10_000);
    expect(sumOfSquares(start)).toBe(260_000);
    expect(furthest(start)).toBe(3);
  });

  it('scores each trade as stated', () => {
    expect(applyTrade(start, trade('A'))).toEqual({ 1: -50, 3: 150, 5: -100 });
    expect(sumOfSquares(applyTrade(start, trade('A')))).toBe(22_500 + 2_500 + 10_000);
    expect(sumOfSquares(applyTrade(start, trade('A')))).toBe(35_000);
    expect(improvement(start, trade('A'))).toBe(225_000);

    expect(applyTrade(start, trade('B'))).toEqual({ 1: 0, 3: 100, 5: -100 });
    expect(sumOfSquares(applyTrade(start, trade('B')))).toBe(20_000);
    expect(improvement(start, trade('B'))).toBe(240_000);

    expect(applyTrade(start, trade('C'))).toEqual({ 1: -300, 3: 280, 5: 20 });
    expect(sumOfSquares(applyTrade(start, trade('C')))).toBe(78_400 + 90_000 + 400);
    expect(sumOfSquares(applyTrade(start, trade('C')))).toBe(168_800);
    expect(improvement(start, trade('C'))).toBe(91_200);
  });

  it('uses the generator’s gain, which equals the drop in the sum of squares', () => {
    for (const t of trades) expect(improvement(start, t)).toBe(sumOfSquares(start) - sumOfSquares(applyTrade(start, t)));
  });

  it('chooses B, then restarts from District 3 on the tie with District 5', () => {
    expect(bestTrade(start, trades).id).toBe('B');
    const after = applyTrade(start, trade('B'));
    expect(Math.abs(after[3]!)).toBe(Math.abs(after[5]!));
    expect(furthest(after)).toBe(3);
  });

  it('drops a trade into the furthest district: it makes the sum bigger', () => {
    expect(improvement(start, { id: 'X', people: 50, from: 1, to: 3 })).toBeLessThan(0);
  });

  it('draws the same figures it states', () => {
    const t = balanceChoiceDiagram().textContent ?? '';
    expect(t).toContain('B: sum of squares 20,000, better by 240,000');
    expect(t).toContain('A: sum of squares 35,000, better by 225,000');
    expect(t).toContain('C: sum of squares 168,800, better by 91,200');
    expect(t).toContain('+400');
    expect(t).toContain('−300');
    expect(signed(0)).toBe('0');
  });
});

describe('cut worked example', () => {
  const people = SPLIT_EXAMPLE.blocks.map((b) => b.people);
  const walk = walkSplit(people, SPLIT_EXAMPLE.seats, SPLIT_EXAMPLE.lowSeats);

  it('walks to a share of 500 and stops after E, which is closer', () => {
    expect(walk.total).toBe(1000);
    expect(walk.share).toBe(500);
    expect(walk.running).toEqual([120, 210, 370, 440, 540, 670, 820, 1000]);
    expect(SPLIT_EXAMPLE.blocks[walk.crossing]!.name).toBe('E');
    expect([walk.before, walk.after]).toEqual([440, 540]);
    expect(walk.count).toBe(5);
  });

  it('stops just before the crossing block on a tie', () => {
    // 460 before, 540 after: both 40 from 500.
    expect(walkSplit([200, 260, 80, 460], 2, 1).count).toBe(2);
  });

  it('agrees with the generator’s own selection, for the example and for ties', () => {
    const check = (pops: number[], seats: number, lowSeats: number) => {
      const m = pops.length;
      const keys = Float64Array.from(pops.map((_, i) => i));
      const ids = Int32Array.from(pops.map((_, i) => i));
      const target = (pops.reduce((s, p) => s + p, 0) * lowSeats) / seats;
      expect(selectLow(keys, ids, Float64Array.from(pops), new Int32Array(m), target)).toBe(walkSplit(pops, seats, lowSeats).count);
    };
    check(people, 2, 1);
    check([200, 260, 80, 460], 2, 1);
    check([300, 100, 100, 500], 3, 1);
    check([900, 50, 50], 2, 1);
    check([10, 10, 10, 970], 2, 1);
  });

  it('draws the shortest border on the shortest line', () => {
    const lengths = directionLengths();
    const byKm = DIRECTION_EXAMPLE.map((d, i) => ({ km: d.km, len: lengths[i]! }));
    const sortedKm = [...byKm].sort((a, b) => a.km - b.km);
    const sortedLen = [...byKm].sort((a, b) => a.len - b.len);
    expect(sortedKm).toEqual(sortedLen);
  });
});

describe('How it works page', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders the worked examples with their numbers and no em dashes', () => {
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    const page = createHowPage({ page: 'how', section: null });
    const text = page.el.textContent ?? '';
    expect(text).toContain('How the next block is chosen');
    expect(text).toContain('How the winning line is chosen');
    expect(text).toContain('Following one state: Colorado');
    expect(text).toContain('400² + 300² + 100² = 260,000');
    expect(text).toContain('The running total passes 500 at block E');
    expect(text).toContain('the next round starts from District 3');
    expect(text).not.toContain(String.fromCharCode(0x2014));
    const chosen = page.el.querySelector('tr[data-chosen="true"] th')?.textContent ?? '';
    expect(chosen).toContain('B: 300 people to District 1');
    page.destroy();
  });
});
