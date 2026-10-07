// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drawChart, updateChart } from '../../src/client/widgets/rule-demo/chart';
import { createRuleDemo } from '../../src/client/widgets/rule-demo';
import { RuleCaseSchema, type RuleCase } from '../../src/client/entities/rule-example';

type Chart = NonNullable<RuleCase['chart']>;
const VIEW = { w: 320, h: 180 };

// A reproducible spread of 1,800 distinct lengths in no particular order.
const strip = (): Chart => {
  const values = Array.from({ length: 1800 }, (_, i) => 300 + ((i * 7919) % 1800) / 3 + i / 10_000);
  return { kind: 'strip', values, marks: { unresolved: [3, 5, 8], winner: [10] } };
};

const case_ = (chart: Chart, steps: RuleCase['steps']): RuleCase => ({
  id: 'cut.test', state: 'CO', stateName: 'Colorado', source: {}, link: { state: 'CO' }, view: VIEW, steps, chart,
});

/** Every mark's [x, top y], read from the path data of all tick paths in a chart. */
function ticks(g: Element): { x: number; top: number; mark: string }[] {
  const out: { x: number; top: number; mark: string }[] = [];
  for (const p of g.querySelectorAll('path.strv-chart__ticks')) {
    for (const m of (p.getAttribute('d') ?? '').matchAll(/M([\d.]+) ([\d.]+)V([\d.]+)/g)) {
      out.push({ x: Number(m[1]), top: Number(m[3]), mark: p.getAttribute('data-mark') ?? '' });
    }
  }
  return out;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('chart schema', () => {
  const base = { id: 'x', state: 'CO', stateName: 'Colorado', source: {}, link: { state: 'CO' }, view: VIEW, steps: [{ caption: 'c', show: [] }] };
  it('takes a baseline and per-value labels, and refuses labels of the wrong count or marks out of range', () => {
    expect(RuleCaseSchema.safeParse({ ...base, chart: { kind: 'bars', values: [1, 2], baseline: 1.5, labels: ['a', 'b'] } }).success).toBe(true);
    expect(RuleCaseSchema.safeParse({ ...base, chart: { kind: 'bars', values: [1, 2], labels: ['a'] } }).success).toBe(false);
    expect(RuleCaseSchema.safeParse({ ...base, chart: { kind: 'bars', values: [1, 2], marks: { m: [2] } } }).success).toBe(false);
  });
});

describe('strip chart', () => {
  it('renders 1,800 marks, in one path per mark class and not one element each', () => {
    const g = drawChart(strip(), VIEW);
    expect(ticks(g)).toHaveLength(1800);
    expect(g.querySelectorAll('*').length).toBeLessThan(20);
    updateChart(g, new Set(['chart', 'chart-unresolved', 'chart-winner']), false);
    const by = (m: string): number => ticks(g).filter((t) => t.mark === m).length;
    expect(by('unresolved')).toBe(3);
    expect(by('winner')).toBe(1);
    expect(by('base')).toBe(1796);
  });

  it('keeps a hidden mark class drawn as an ordinary mark', () => {
    const g = drawChart(strip(), VIEW);
    updateChart(g, new Set(['chart']), false);
    expect(ticks(g).filter((t) => t.mark !== 'base')).toHaveLength(0);
    expect(ticks(g)).toHaveLength(1800);
  });

  it('sort step reorders by value: shortest at the left, longest at the right', () => {
    const c = strip();
    const g = drawChart(c, VIEW);
    updateChart(g, new Set(['chart']), false);
    const before = ticks(g);
    // In angle order the first tick sits at the left edge, whatever its length.
    const left = (ts: typeof before): number[] => [...ts].sort((a, b) => a.x - b.x).map((t) => t.top);
    expect(left(before)).not.toEqual([...left(before)].sort((a, b) => b - a));
    updateChart(g, new Set(['chart', 'chart-sorted']), false);
    const after = left(ticks(g));
    // A higher value has a smaller top y; left to right the tops must fall.
    expect(after).toEqual([...after].sort((a, b) => b - a));
    expect(new Set(ticks(g).map((t) => t.x)).size).toBe(1800);
  });

  it('glides to the sorted order over the tween and lands on it', () => {
    const d = createRuleDemo(case_(strip(), [
      { caption: 'one', show: ['chart'] },
      { caption: 'two', show: ['chart', 'chart-sorted'] },
    ]));
    const g = d.el.querySelector('[data-id="chart"]')!;
    const start = ticks(g).map((t) => t.x);
    d.step(1, true);
    vi.advanceTimersByTime(300);
    const mid = ticks(g).map((t) => t.x);
    expect(mid).not.toEqual(start);
    vi.advanceTimersByTime(600);
    const end = ticks(g);
    const tops = [...end].sort((a, b) => a.x - b.x).map((t) => t.top);
    expect(tops).toEqual([...tops].sort((a, b) => b - a));
    d.destroy();
  });

  it('lands on the sorted order at once under reduced motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q }));
    const d = createRuleDemo(case_(strip(), [
      { caption: 'one', show: ['chart'] },
      { caption: 'two', show: ['chart', 'chart-sorted'] },
    ]));
    d.step(1, true);
    const tops = [...ticks(d.el)].sort((a, b) => a.x - b.x).map((t) => t.top);
    expect(tops).toEqual([...tops].sort((a, b) => b - a));
    d.destroy();
  });

  it('is shown and hidden by the chart id, with no inline style', () => {
    const d = createRuleDemo(case_(strip(), [
      { caption: 'none', show: [] },
      { caption: 'on', show: ['chart'] },
    ]));
    const g = d.el.querySelector('[data-id="chart"]')!;
    expect(g.classList.contains('strv-rule-demo__off')).toBe(true);
    d.step(1, true);
    expect(g.classList.contains('strv-rule-demo__off')).toBe(false);
    expect(d.el.querySelectorAll('[style]').length).toBe(0);
    d.destroy();
  });
});

describe('bars chart', () => {
  const populations = [769_364, 769_365, 769_364, 769_365, 769_365, 769_364, 769_364, 769_364];

  it('draws balance.ideal: populations as bars from the ideal, the on-target ones marked', () => {
    const chart: Chart = { kind: 'bars', values: populations, baseline: 769_364.125, labels: populations.map((_, i) => String(i + 1)), marks: { onTarget: [0, 1, 2, 3, 4, 5, 6, 7] } };
    const g = drawChart(chart, VIEW);
    updateChart(g, new Set(['chart', 'chart-onTarget']), false);
    const bars = [...g.querySelectorAll('rect.strv-chart__bar')];
    expect(bars).toHaveLength(8);
    expect(bars.every((b) => b.getAttribute('data-mark') === 'onTarget')).toBe(true);
    // 769,365 is above the ideal (bar rises above the axis), 769,364 below it.
    const axis = Number(g.querySelector('.strv-chart__axis')!.getAttribute('d')!.match(/M[\d.]+ ([\d.]+)/)![1]);
    const top = (i: number): number => Number(bars[i]!.getAttribute('y'));
    const h = (i: number): number => Number(bars[i]!.getAttribute('height'));
    expect(top(1) + h(1)).toBeCloseTo(axis, 1);
    expect(top(0)).toBeCloseTo(axis, 1);
    expect(h(0)).toBeGreaterThan(0);
    expect(g.querySelectorAll('text').length).toBe(8);
    updateChart(g, new Set(['chart']), false);
    expect(bars.every((b) => !b.hasAttribute('data-mark'))).toBe(true);
  });

  it('draws signed deviations either side of the axis, the furthest marked', () => {
    const chart: Chart = { kind: 'bars', values: [-91.25, -175.25, 11.75, 185.75], marks: { furthest: [3] } };
    const g = drawChart(chart, VIEW);
    updateChart(g, new Set(['chart', 'chart-furthest']), false);
    const axis = Number(g.querySelector('.strv-chart__axis')!.getAttribute('d')!.match(/M[\d.]+ ([\d.]+)/)![1]);
    const bars = [...g.querySelectorAll('rect.strv-chart__bar')];
    expect(Number(bars[3]!.getAttribute('y')) + Number(bars[3]!.getAttribute('height'))).toBeCloseTo(axis, 1);
    expect(Number(bars[1]!.getAttribute('y'))).toBeCloseTo(axis, 1);
    expect(Number(bars[3]!.getAttribute('height'))).toBeGreaterThan(Number(bars[1]!.getAttribute('height')));
    expect(bars.map((b) => b.getAttribute('data-mark'))).toEqual([null, null, null, 'furthest']);
  });
});

describe('series chart', () => {
  it('draws one point per value, falling values falling on screen, with the marked points', () => {
    const chart: Chart = { kind: 'series', values: [100, 60, 30, 10, 0], marks: { first: [0], last: [4] } };
    const g = drawChart(chart, VIEW);
    updateChart(g, new Set(['chart', 'chart-first', 'chart-last']), false);
    const dots = [...g.querySelectorAll('circle.strv-chart__dot')];
    expect(dots).toHaveLength(5);
    const ys = dots.map((d) => Number(d.getAttribute('cy')));
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(dots.map((d) => d.getAttribute('data-mark'))).toEqual(['first', null, null, null, 'last']);
    const line = g.querySelector('path.strv-chart__line')!.getAttribute('d')!;
    expect(line.match(/[ML]/g)).toHaveLength(5);
  });
});
