// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createProcessPanel } from '../../src/client/widgets/process-panel';
import type { Metrics } from '../../src/client/entities/plan';

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
