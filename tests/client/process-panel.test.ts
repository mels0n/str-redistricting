// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createProcessPanel } from '../../src/client/widgets/process-panel';
import { MetricsSchema, type Metrics } from '../../src/client/entities/plan';

const metrics = {
  state: 'CA', lineSearch: 'exact', inputSha256: 'a'.repeat(64), seats: 52, population: 39538223, ideal: 760350.4, rangePersons: 12, rangePct: 0,
  allContiguous: true, assignmentSha256: 'b'.repeat(64), balanceMoves: 127, peopleMovedByBalancing: 3283, rangeBeforeBalancing: 585, rangeAfterBalancing: 12,
  cuts: 51, candidateRangesPerCut: Array.from({ length: 51 }, (_, i) => 20 + i), candidateRangesEvaluated: 2295, strayBlocksMoved: 1710, strayPopMoved: 114875, recounts: 69, recountsMaxPerCut: 4, runtimeMs: 392000,
  countiesSplit: 10, countiesTotal: 58, blocks: 519723,
} as unknown as Metrics;

const single = { ...metrics, state: 'AK', seats: 1, cuts: 0, candidateRangesPerCut: [], candidateRangesEvaluated: 0, strayBlocksMoved: 0, strayPopMoved: 0, recounts: 0, recountsMaxPerCut: 0, balanceMoves: 0, peopleMovedByBalancing: 0, rangeBeforeBalancing: 0, rangeAfterBalancing: 0 } as unknown as Metrics;

/** term → the How it works section its label opens. */
function links(el: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dt of el.querySelectorAll('dt')) {
    const a = dt.querySelector('a');
    out[dt.textContent!.trim()] = a?.getAttribute('href') ?? '';
  }
  return out;
}

describe('What happened in this state', () => {
  it('links every row to the stage of How it works that explains it', () => {
    const el = createProcessPanel({ stateName: 'California', metrics, onWatch: () => undefined });
    expect(links(el)).toEqual({
      Cuts: '#/how/recursion',
      'Stretches checked': '#/how/cut',
      'Strays moved': '#/how/strays',
      'Re-counts': '#/how/strays',
      'Balancing moves': '#/how/balancing',
      'Population range': '#/how/balancing',
      'Run time': '#/how/fingerprint',
    });
  });

  it('reports the checked stretches of directions in total and per cut', () => {
    const el = createProcessPanel({ stateName: 'California', metrics, onWatch: () => undefined });
    expect(el.textContent).toContain('2,295');
    expect(el.textContent).toContain('20 to 70 for each cut.');
    expect(el.textContent).not.toMatch(/1,800|0\.1/);
  });

  it('names where each link goes for a screen reader', () => {
    const el = createProcessPanel({ stateName: 'California', metrics, onWatch: () => undefined });
    const a = [...el.querySelectorAll('dt a')].find((x) => x.textContent === 'Re-counts')!;
    expect(a.getAttribute('aria-label')).toBe('Re-counts: how this stage works');
  });

  it('links the rows of a one-seat state too', () => {
    const el = createProcessPanel({ stateName: 'Alaska', metrics: single, onWatch: () => undefined });
    expect(links(el)).toEqual({ Cuts: '#/how/recursion', 'Balancing moves': '#/how/balancing', 'Run time': '#/how/fingerprint' });
  });
});

describe('balancing moves that only shortened the border', () => {
  const text = (m: Metrics) => createProcessPanel({ stateName: 'California', metrics: m, onWatch: () => undefined }).textContent!;
  it('reports how many moves only shortened the border', () => {
    expect(text({ ...metrics, balanceMovesBorderOnly: 41, peopleMovedBorderOnly: 90 })).toContain('41 of 127 moves only shortened the border.');
  });
  it('says so when none did, and uses the singular for one move', () => {
    expect(text({ ...metrics, balanceMovesBorderOnly: 0, peopleMovedBorderOnly: 0 })).toContain(`None of the ${metrics.balanceMoves.toLocaleString('en-US')} moves only shortened the border.`);
    expect(text({ ...metrics, balanceMoves: 1, peopleMovedByBalancing: 5, balanceMovesBorderOnly: 1, peopleMovedBorderOnly: 5 })).toContain('1 of 1 move only shortened the border.');
  });
  it('shows nothing when the stats predate the count or no move was made', () => {
    expect(text(metrics)).not.toContain('only shortened');
    expect(text({ ...single, balanceMovesBorderOnly: 0, peopleMovedBorderOnly: 0 })).not.toContain('only shortened');
  });
  it('parses stats metrics with and without the fields', () => {
    const base = { ...metrics } as Record<string, unknown>;
    expect(MetricsSchema.safeParse(base).success).toBe(true);
    const withFields = MetricsSchema.safeParse({ ...base, balanceMovesBorderOnly: 41, peopleMovedBorderOnly: 90 });
    expect(withFields.success && withFields.data.balanceMovesBorderOnly).toBe(41);
    expect(MetricsSchema.safeParse({ ...base, balanceMovesBorderOnly: -1 }).success).toBe(false);
  });
});
