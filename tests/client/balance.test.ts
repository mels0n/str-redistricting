import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BalanceSchema,
  StatsSchema,
  balancePlayInterval,
  checkLog,
  isSeqEnd,
  moveDetail,
  movedBlocksAt,
  pageAt,
  pageOf,
  populationsAfter,
  rangeOf,
  seqFromIndex,
  seqIndex,
  seqLength,
  seqStep,
  type BalanceMove,
  type SeqPos,
} from '../../src/client/entities/plan';
import { sparseTicks, collidingTicks } from '../../src/client/features/cut-scrubber/ticks';
import { formatRunTime } from '../../src/client/widgets/process-panel';

const PILOTS = ['RI', 'CT', 'CO', 'MD', 'NC', 'NM', 'MO', 'MI', 'WA', 'LA', 'CA', 'TX'];

const data = (p: string): unknown => JSON.parse(readFileSync(new URL(`../../public/data/${p}`, import.meta.url), 'utf8'));

const mv = (order: number, from: number, to: number, pop: number, geoid = `0800000000000${String(order).padStart(2, '0')}`): BalanceMove => ({
  order,
  geoid,
  from,
  to,
  pop,
  gain: 1,
});

describe('applying balancing moves', () => {
  const before = [1000, 1060, 940];
  const moves = [mv(1, 2, 3, 50), mv(2, 2, 1, 5), mv(3, 1, 3, 4, '080000000000001')];

  it('starts from the populations before balancing and applies moves in order', () => {
    expect(populationsAfter(before, moves, 0)).toEqual([1000, 1060, 940]);
    expect(populationsAfter(before, moves, 1)).toEqual([1000, 1010, 990]);
    expect(populationsAfter(before, moves, 2)).toEqual([1005, 1005, 990]);
    expect(populationsAfter(before, moves, 3)).toEqual([1001, 1005, 994]);
    // Past either end it holds at the end.
    expect(populationsAfter(before, moves, 99)).toEqual(populationsAfter(before, moves, 3));
    expect(populationsAfter(before, moves, -4)).toEqual(before);
    // The input is never changed.
    expect(before).toEqual([1000, 1060, 940]);
  });

  it('keeps the total population', () => {
    for (let m = 0; m <= moves.length; m++) expect(populationsAfter(before, moves, m).reduce((a, b) => a + b)).toBe(3000);
  });

  it('reports each move with the gap between its two districts', () => {
    expect(moveDetail(before, moves, 0)).toBeNull();
    expect(moveDetail(before, moves, 4)).toBeNull();
    const d = moveDetail(before, moves, 1)!;
    expect(d).toMatchObject({ fromBefore: 1060, fromAfter: 1010, toBefore: 940, toAfter: 990, gapBefore: 120, gapAfter: 20 });
    const d2 = moveDetail(before, moves, 2)!;
    expect(d2).toMatchObject({ fromBefore: 1010, toBefore: 1000, gapBefore: 10, gapAfter: 0 });
  });

  it('measures the range between the largest and smallest district', () => {
    expect(rangeOf([5, 9, 1])).toBe(8);
    expect(rangeOf([])).toBe(0);
  });

  it('tracks which district each moved block is in, including a block that moves twice', () => {
    const twice = [mv(1, 1, 2, 10, 'A'), mv(2, 2, 3, 10, 'A'), mv(3, 3, 1, 4, 'B')];
    expect(movedBlocksAt(twice, 0).size).toBe(0);
    expect(movedBlocksAt(twice, 1).get('A')).toBe(2);
    expect(movedBlocksAt(twice, 2).get('A')).toBe(3);
    expect([...movedBlocksAt(twice, 3)]).toEqual([
      ['A', 3],
      ['B', 1],
    ]);
  });
});

describe('the published balancing logs join the two phases', () => {
  it('start from the plan before balancing and end exactly on the finished map, in every state', () => {
    for (const abbr of PILOTS) {
      const stats = StatsSchema.parse(data(`${abbr}/stats.json`));
      const log = BalanceSchema.parse(data(`${abbr}/balance.json`));
      const moves = [...log.moves].sort((a, b) => a.order - b.order);
      expect(() => checkLog(abbr, log.before, moves, stats)).not.toThrow();
      const pops = (ds: { district: number; pop: number }[]): number[] => [...ds].sort((a, b) => a.district - b.district).map((d) => d.pop);
      expect(log.before).toEqual(pops(stats.beforeBalancing.districts));
      expect(populationsAfter(log.before, moves, moves.length)).toEqual(pops(stats.finished.districts));
      const m = stats.finished.metrics;
      expect(rangeOf(log.before)).toBe(m.rangeBeforeBalancing);
      expect(rangeOf(populationsAfter(log.before, moves, moves.length))).toBe(m.rangeAfterBalancing);
      expect(moves.reduce((t, x) => t + x.pop, 0)).toBe(m.peopleMovedByBalancing);
      // Every move strictly narrows the gap between its two districts.
      for (let k = 1; k <= moves.length; k++) {
        const d = moveDetail(log.before, moves, k)!;
        expect(d.gapAfter).toBeLessThan(d.gapBefore);
      }
      // Every moved block has an outline to draw.
      for (const x of moves) expect(log.blocks[x.geoid]).toBeDefined();
    }
  });

  it('rejects a log that does not end on the finished map', () => {
    const stats = StatsSchema.parse(data('RI/stats.json'));
    const log = BalanceSchema.parse(data('RI/balance.json'));
    const bad = log.moves.map((x) => ({ ...x, pop: x.pop + 1 }));
    expect(() => checkLog('RI', log.before, bad, stats)).toThrow(/finished map/);
    expect(() => checkLog('RI', [1, 2], log.moves, stats)).toThrow();
  });
});

describe('the sequence: cuts, then balancing', () => {
  const size = { cuts: 7, moves: 22 };
  const at = (p: SeqPos): number => seqIndex(p, size);

  it('numbers every position once, cuts first', () => {
    expect(seqLength(size)).toBe(7 + 1 + 22);
    for (let i = 0; i <= seqLength(size); i++) expect(at(seqFromIndex(i, size))).toBe(i);
    expect(seqFromIndex(0, size)).toEqual({ phase: 'cut', k: 0 });
    expect(seqFromIndex(7, size)).toEqual({ phase: 'cut', k: 7 });
    expect(seqFromIndex(8, size)).toEqual({ phase: 'balance', m: 0 });
    expect(seqFromIndex(30, size)).toEqual({ phase: 'balance', m: 22 });
    expect(seqFromIndex(999, size)).toEqual({ phase: 'balance', m: 22 });
    expect(seqFromIndex(Number.NaN, size)).toEqual({ phase: 'cut', k: 0 });
  });

  it('steps from the last cut into the balancing and back', () => {
    expect(seqStep({ phase: 'cut', k: 6 }, 1, size)).toEqual({ phase: 'cut', k: 7 });
    expect(seqStep({ phase: 'cut', k: 7 }, 1, size)).toEqual({ phase: 'balance', m: 0 });
    expect(seqStep({ phase: 'balance', m: 0 }, 1, size)).toEqual({ phase: 'balance', m: 1 });
    expect(seqStep({ phase: 'balance', m: 0 }, -1, size)).toEqual({ phase: 'cut', k: 7 });
    expect(seqStep({ phase: 'cut', k: 0 }, -1, size)).toEqual({ phase: 'cut', k: 0 });
    expect(seqStep({ phase: 'balance', m: 22 }, 1, size)).toEqual({ phase: 'balance', m: 22 });
  });

  it('ends on the last balancing move, or on the last cut when there was no balancing', () => {
    expect(isSeqEnd({ phase: 'balance', m: 22 }, size)).toBe(true);
    expect(isSeqEnd({ phase: 'cut', k: 7 }, size)).toBe(false);
    const none = { cuts: 3, moves: 0 };
    expect(seqLength(none)).toBe(3);
    expect(isSeqEnd({ phase: 'cut', k: 3 }, none)).toBe(true);
    expect(seqStep({ phase: 'cut', k: 3 }, 1, none)).toEqual({ phase: 'cut', k: 3 });
  });
});

describe('playing a long balancing log', () => {
  const opts = { baseMs: 1000, totalMs: 45000, minMs: 120 };

  it('plays a short log at the base pace and speeds up a long one, within a floor', () => {
    expect(balancePlayInterval(22, opts)).toBe(1000);
    expect(balancePlayInterval(282, opts)).toBe(160);
    expect(balancePlayInterval(473, opts)).toBe(120);
    expect(balancePlayInterval(0, opts)).toBe(1000);
  });

  it('pages the move list and finds the page of any move', () => {
    expect(pageOf(0, 473, 50)).toEqual({ page: 0, pages: 10, start: 0, end: 50 });
    expect(pageOf(472, 473, 50)).toEqual({ page: 9, pages: 10, start: 450, end: 473 });
    expect(pageAt(99, 473, 50).page).toBe(9);
    expect(pageAt(-1, 22, 50)).toEqual({ page: 0, pages: 1, start: 0, end: 22 });
  });

  it('labels a long axis with round numbers that never crowd', () => {
    expect(sparseTicks(22)).toEqual([0, 5, 10, 15, 22]);
    expect(sparseTicks(473)).toEqual([0, 50, 100, 150, 200, 250, 300, 350, 400, 473]);
    expect(sparseTicks(282)).toEqual([0, 50, 100, 150, 200, 250, 282]);
    expect(sparseTicks(1)).toEqual([0, 1]);
    // A round number right next to the end gives way to the end.
    expect(sparseTicks(101)).toEqual([0, 20, 40, 60, 80, 101]);
    // The current label pushes aside only the labels it would sit on.
    const hidden = collidingTicks(473, 251, 300, sparseTicks(473));
    expect([...hidden]).toEqual([250]);
  });
});

describe('the state panel', () => {
  it('prints run times plainly', () => {
    expect(formatRunTime(35225)).toBe('35.2 seconds');
    expect(formatRunTime(331526)).toBe('5 minutes 32 seconds');
    expect(formatRunTime(60000)).toBe('1 minute');
  });
});
