// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRuleDemo } from '../../src/client/widgets/rule-demo';
import type { RuleCase } from '../../src/client/entities/rule-example';

const steps = (n: number): RuleCase['steps'] =>
  Array.from({ length: n }, (_, i) => ({ caption: `Caption ${i + 1}`, show: ['a'] }));

const base = (over: Partial<RuleCase> = {}): RuleCase => ({
  id: 'cut.test',
  state: 'CO',
  stateName: 'Colorado',
  source: { cut: 3 },
  link: { state: 'CO', cut: 3 },
  view: { w: 320, h: 180 },
  labels: [{ id: 'a', x: 160, y: 60, text: 'hello' }],
  steps: steps(5),
  ...over,
});

const caption = (el: HTMLElement): HTMLElement => el.querySelector('.strv-rule-demo__caption')!;
const counter = (el: HTMLElement): string => el.querySelector('.strv-rule-demo__count')!.textContent ?? '';
const button = (el: HTMLElement, label: string): HTMLButtonElement => el.querySelector(`button[aria-label="${label}"]`)!;

function stubMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce'), media: q }));
}

beforeEach(() => {
  vi.useFakeTimers();
  stubMotion(false);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('rule demo widget', () => {
  it('next and previous move one step and update the caption and counter', () => {
    const d = createRuleDemo(base());
    expect(caption(d.el).textContent).toBe('Caption 1');
    expect(counter(d.el)).toBe('Step 1 of 5');
    button(d.el, 'Next step').click();
    expect(caption(d.el).textContent).toBe('Caption 2');
    expect(counter(d.el)).toBe('Step 2 of 5');
    button(d.el, 'Previous step').click();
    expect(caption(d.el).textContent).toBe('Caption 1');
    d.destroy();
  });

  it('autoplay advances every 2,200 ms and stops at the last step', () => {
    const d = createRuleDemo(base());
    d.play();
    vi.advanceTimersByTime(2199);
    expect(counter(d.el)).toBe('Step 1 of 5');
    vi.advanceTimersByTime(1);
    expect(counter(d.el)).toBe('Step 2 of 5');
    vi.advanceTimersByTime(2200 * 10);
    expect(counter(d.el)).toBe('Step 5 of 5');
    expect(vi.getTimerCount()).toBe(0);
    d.destroy();
  });

  it('pause stops autoplay and a manual step pauses it', () => {
    const d = createRuleDemo(base());
    d.play();
    vi.advanceTimersByTime(2200);
    d.pause();
    vi.advanceTimersByTime(10_000);
    expect(counter(d.el)).toBe('Step 2 of 5');
    d.play();
    button(d.el, 'Next step').click();
    vi.advanceTimersByTime(10_000);
    expect(counter(d.el)).toBe('Step 3 of 5');
    d.destroy();
  });

  it('reduced motion never autoplays', () => {
    stubMotion(true);
    const d = createRuleDemo(base());
    d.play();
    vi.advanceTimersByTime(20_000);
    expect(counter(d.el)).toBe('Step 1 of 5');
    expect(d.el.querySelector('button[aria-label="Play"]')).toBeNull();
    button(d.el, 'Next step').click();
    expect(counter(d.el)).toBe('Step 2 of 5');
    d.destroy();
  });

  it('user stepping announces, autoplay does not', () => {
    const d = createRuleDemo(base());
    expect(caption(d.el).getAttribute('aria-live')).toBe('off');
    d.play();
    vi.advanceTimersByTime(2200);
    expect(caption(d.el).getAttribute('aria-live')).toBe('off');
    button(d.el, 'Next step').click();
    expect(caption(d.el).getAttribute('aria-live')).toBe('polite');
    d.destroy();
  });

  it('names the state when there is no cut or move', () => {
    const d = createRuleDemo(base({ link: { state: 'CO' } }));
    expect(d.el.querySelector('a')!.textContent).toBe('Open Colorado');
    d.destroy();
  });

  it('toggle reads Pause while autoplay runs and Play once it reaches the last step', () => {
    const d = createRuleDemo(base());
    const toggle = d.el.querySelector<HTMLButtonElement>('.strv-rule-demo__btn')!;
    expect(toggle.getAttribute('aria-label')).toBe('Play');
    d.play();
    expect(toggle.getAttribute('aria-label')).toBe('Pause');
    vi.advanceTimersByTime(2200);
    expect(counter(d.el)).toBe('Step 2 of 5');
    expect(toggle.getAttribute('aria-label')).toBe('Pause');
    expect(toggle.textContent).toBe('Pause');
    vi.advanceTimersByTime(2200 * 3);
    expect(counter(d.el)).toBe('Step 5 of 5');
    expect(toggle.getAttribute('aria-label')).toBe('Play');
    d.destroy();
  });

  it('keeps focus on a button that reaches the end of the steps and ignores its click', () => {
    const d = createRuleDemo(base({ steps: steps(2) }));
    document.body.append(d.el);
    const next = button(d.el, 'Next step');
    next.focus();
    next.click();
    expect(counter(d.el)).toBe('Step 2 of 2');
    expect(next.getAttribute('aria-disabled')).toBe('true');
    expect(next.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(next);
    next.click();
    expect(counter(d.el)).toBe('Step 2 of 2');
    const prev = button(d.el, 'Previous step');
    d.step(0, true);
    prev.click();
    expect(counter(d.el)).toBe('Step 1 of 2');
    d.el.remove();
    d.destroy();
  });

  it('orders the controls Play or Pause, Previous, Next', () => {
    const d = createRuleDemo(base());
    expect([...d.el.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Play', 'Previous step', 'Next step']);
    d.destroy();
  });

  it('missing case renders its caption and no controls', () => {
    const d = createRuleDemo(base({ missing: 'No such case', steps: [{ caption: 'No real state shows this yet.', show: [] }] }));
    expect(caption(d.el).textContent).toBe('No real state shows this yet.');
    expect(d.el.querySelector('button')).toBeNull();
    expect(d.el.querySelector('svg')).toBeNull();
    expect(d.el.querySelector('a')).toBeNull();
    d.destroy();
  });

  it('link opens the state at the case cut', () => {
    const d = createRuleDemo(base());
    const a = d.el.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('#/CO/cut/3');
    expect(a.textContent).toBe('Open Colorado at cut 3');
    d.destroy();
  });

  it('shows only the shapes a step lists and wraps a long label inside the view', () => {
    const hash = 'e'.repeat(64);
    const d = createRuleDemo(
      base({
        labels: [
          { id: 'a', x: 160, y: 60, text: 'one' },
          { id: 'b', x: 160, y: 110, text: hash },
        ],
        steps: [
          { caption: 's1', show: ['a'] },
          { caption: 's2', show: ['a', 'b'] },
        ],
      }),
    );
    const off = (id: string): boolean => d.el.querySelector(`[data-id="${id}"]`)!.classList.contains('strv-rule-demo__off');
    expect(off('a')).toBe(false);
    expect(off('b')).toBe(true);
    d.step(1, true);
    expect(off('b')).toBe(false);
    const b = d.el.querySelector('[data-id="b"]')!;
    expect(b.querySelectorAll('tspan').length).toBeGreaterThan(1);
    expect([...b.querySelectorAll('tspan')].every((t) => (t.textContent ?? '').length <= 43)).toBe(true);
    expect([...b.querySelectorAll('tspan')].map((t) => t.textContent).join('')).toBe(hash);
    d.destroy();
  });

  it('tweens a polygon to its new points, finishing at once under reduced motion', () => {
    const c = base({
      blocks: [{ id: 'blk', geoid: '1', pop: 1, ring: [[0, 0], [10, 0], [10, 10]] }],
      steps: [
        { caption: 's1', show: ['blk'] },
        { caption: 's2', show: ['blk'], tween: [{ id: 'blk', to: [[0, 0], [20, 0], [20, 20]] }] },
      ],
    });
    const d = createRuleDemo(c);
    const poly = d.el.querySelector('[data-id="blk"]')!;
    expect(poly.getAttribute('points')).toBe('0,0 10,0 10,10');
    d.step(1, true);
    vi.advanceTimersByTime(700);
    expect(poly.getAttribute('points')).toBe('0,0 20,0 20,20');
    d.destroy();

    stubMotion(true);
    const r = createRuleDemo(c);
    r.step(1, true);
    expect(r.el.querySelector('[data-id="blk"]')!.getAttribute('points')).toBe('0,0 20,0 20,20');
    r.destroy();
  });
});

describe('published rule examples', () => {
  it('parse with the client schema and render a panel each', async () => {
    const { readFileSync } = await import('node:fs');
    const { RuleExamplesSchema } = await import('../../src/client/entities/rule-example');
    const file = RuleExamplesSchema.parse(JSON.parse(readFileSync('public/data/how/rule-examples.json', 'utf8')));
    expect(file.cases.length).toBeGreaterThan(0);
    for (const c of file.cases) {
      const d = createRuleDemo(c);
      expect(d.el.querySelector('.strv-rule-demo__caption')!.textContent).toBe(c.steps[0]!.caption);
      for (const t of d.el.querySelectorAll('tspan')) expect((t.textContent ?? '').length).toBeLessThanOrEqual(43);
      d.destroy();
    }
  });
});
