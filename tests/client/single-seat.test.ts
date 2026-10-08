// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createCutScrubber } from '../../src/client/features/cut-scrubber';
import { createProcessPanel } from '../../src/client/widgets/process-panel';
import { createProofPanel } from '../../src/client/widgets/proof-panel';
import { createExplainer } from '../../src/client/widgets/explainer';
import { createStateIndex } from '../../src/client/widgets/state-index';
import { districtCount, fitRouteToState, describeRouteIssue, parseHash } from '../../src/client/shared';
import type { Metrics } from '../../src/client/entities/plan';
import type { StateIndex } from '../../src/client/entities/state';

const metrics = {
  state: 'AK', angleStepDeg: 0.1, inputSha256: 'a'.repeat(64), seats: 1, population: 733391, ideal: 733391, rangePersons: 0, rangePct: 0,
  allContiguous: true, assignmentSha256: 'b'.repeat(64), balanceMoves: 0, peopleMovedByBalancing: 0, rangeBeforeBalancing: 0, rangeAfterBalancing: 0,
  cuts: 0, angleCount: 1800, candidateLinesEvaluated: 0, strayBlocksMoved: 0, strayPopMoved: 0, recounts: 0, recountsMaxPerCut: 0, runtimeMs: 7151,
  countiesSplit: 0, countiesTotal: 30, blocks: 28568,
} as unknown as Metrics;

const EM_DASH = String.fromCharCode(0x2014);
const noDash = (el: HTMLElement): void => expect(el.textContent).not.toContain(EM_DASH);

describe('a state with one seat', () => {
  it('counts districts in the singular', () => {
    expect(districtCount(1)).toBe('1 district');
    expect(districtCount(2)).toBe('2 districts');
  });

  it('replaces the scrubber with a plain note', () => {
    const s = createCutScrubber({ cuts: [], seats: 1, moves: 0, peopleMoved: 0, rangeBefore: 0, onStep: () => undefined, onFinish: () => undefined, onZoomToMove: () => undefined });
    expect(s.el.textContent).toContain('one seat, so there is nothing to cut or balance');
    expect(s.el.querySelector('input[type="range"]')).toBeNull();
    expect(s.el.querySelector('button')).toBeNull();
    s.update(null, { log: { status: 'idle' }, canZoom: false });
    s.start('cuts');
    s.destroy();
    noDash(s.el);
  });

  it('explains the process without cuts to watch', () => {
    const el = createProcessPanel({ stateName: 'Alaska', metrics, onWatch: () => undefined });
    expect(el.textContent).toContain('Alaska has one seat');
    expect(el.textContent).not.toMatch(/\b1 seats\b|\b0 cuts\b/);
    expect(el.querySelector('button')).toBeNull();
    noDash(el);
  });

  it('shows the proof panel with no guide lines or balancing', () => {
    const p = createProofPanel();
    p.update({ metrics, plan: 'finished', abbr: 'AK' });
    expect(p.el.textContent).toContain('The district is one connected piece.');
    expect(p.el.textContent).not.toMatch(/1 districts|directions tried/);
    expect(p.el.textContent).toContain('nothing to balance');
    noDash(p.el);
  });

  it('says the explainer needs no cut', () => {
    const el = createExplainer({ seats: 1 });
    expect(el.textContent).toContain('needs no cut');
    expect(el.textContent).not.toMatch(/0 cuts|1 seats/);
  });

  it('links the explainer to why a district can look strange', () => {
    const el = createExplainer({ seats: 3 });
    expect(el.querySelector('a[href="#/how/strange"]')?.textContent).toContain('look strange');
  });

  it('corrects a link to a cut that does not exist', () => {
    const route = parseHash('#/AK/cut/1');
    if (route.page !== 'state') throw new Error('not a state route');
    const fit = fitRouteToState(route, 1, 0);
    expect(fit.route.cut).toBeNull();
    expect(fit.issues[0] && describeRouteIssue(fit.issues[0], 'Alaska')).toBe('Alaska is a single district, so there are no cuts to show.');
  });
});

describe('the state list with every state mapped', () => {
  const summary = { population: 1, ideal: 1, rangePersons: 0, rangePct: 0, allContiguous: true, assignmentSha256: 'a'.repeat(64), inputSha256: 'b'.repeat(64), angleStepDeg: 0.1 };
  const index = { states: [{ abbr: 'WY', name: 'Wyoming', seats: 1, hasData: true, summary }, { abbr: 'AK', name: 'Alaska', seats: 1, hasData: true, summary }] } as StateIndex;
  it('lists them alphabetically and says all of them have maps', () => {
    const el = createStateIndex(index);
    expect([...el.querySelectorAll('.strv-index__name')].map((n) => n.textContent)).toEqual(['Alaska', 'Wyoming']);
    expect(el.querySelector('.strv-index__lede')!.textContent).toBe('Maps are available for all 2 states, covering all 2 House seats.');
    expect(el.textContent).toContain('1 seat');
  });
});
