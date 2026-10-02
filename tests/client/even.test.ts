import { describe, expect, it } from 'vitest';
import { describeFromEven, evenSizes, evenSplit, evenSplitSentence, formatEvenPct, fromEven } from '../../src/client/entities/plan/even';

// Missouri: 6,154,913 people, 8 seats, so the ideal is 769,364.125.
const MO = { total: 6154913, seats: 8 };
// A state that divides exactly.
const EXACT = { total: 8000, seats: 8 };

describe('even split', () => {
  it('is the ideal rounded down and up, or exactly the ideal when it divides', () => {
    expect(evenSplit(MO.total, MO.seats)).toEqual({ low: 769364, high: 769365, exact: false });
    expect(evenSplit(EXACT.total, EXACT.seats)).toEqual({ low: 1000, high: 1000, exact: true });
    expect(evenSizes(MO.total, MO.seats)).toBe('769,364 or 769,365');
    expect(evenSplitSentence(MO.total, MO.seats)).toBe('An even split is 769,364 or 769,365 people');
    expect(evenSplitSentence(EXACT.total, EXACT.seats)).toBe('An even split is exactly 1,000 people');
  });
});

describe('fromEven', () => {
  it('is 0 for both sizes of an even split', () => {
    expect(fromEven(769364, MO.total, MO.seats)).toEqual({ delta: 0, label: '0', pct: '0%' });
    expect(fromEven(769365, MO.total, MO.seats)).toEqual({ delta: 0, label: '0', pct: '0%' });
  });

  it('counts whole people above and below an exact division', () => {
    expect(fromEven(1000, EXACT.total, EXACT.seats).delta).toBe(0);
    expect(fromEven(1003, EXACT.total, EXACT.seats)).toEqual({ delta: 3, label: '+3', pct: '+0.3%' });
    expect(fromEven(990, EXACT.total, EXACT.seats)).toEqual({ delta: -10, label: '−10', pct: '−1%' });
  });

  it('measures from the nearer end of the even split when there is a remainder', () => {
    expect(fromEven(769367, MO.total, MO.seats)).toMatchObject({ delta: 2, label: '+2' });
    expect(fromEven(769363, MO.total, MO.seats)).toMatchObject({ delta: -1, label: '−1' });
  });

  it('is always an integer', () => {
    for (let pop = 769360; pop <= 769370; pop++) expect(Number.isInteger(fromEven(pop, MO.total, MO.seats).delta)).toBe(true);
  });

  it('formats the percent of the lower even-split size to 2 significant figures', () => {
    expect(fromEven(769367, MO.total, MO.seats).pct).toBe('<0.001%');
    expect(fromEven(769363, MO.total, MO.seats).pct).toBe('<0.001%');
    expect(formatEvenPct(0)).toBe('0%');
    expect(formatEvenPct(0.0013456)).toBe('+0.0013%');
    expect(formatEvenPct(-0.12345)).toBe('−0.12%');
    expect(formatEvenPct(1.234)).toBe('+1.2%');
    expect(formatEvenPct(12.3)).toBe('+12%');
  });

  it('says it in words for a screen reader', () => {
    expect(describeFromEven(0)).toBe('an even-split size');
    expect(describeFromEven(2)).toBe('2 people above an even split');
    expect(describeFromEven(-1)).toBe('1 person below an even split');
  });
});
