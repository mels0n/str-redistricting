// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chamber } from '../../src/client/shared';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('fetch', (url: string) => {
    const path = new URL(String(url)).pathname.replace(/^.*\/data\//, '');
    try {
      return Promise.resolve(new Response(readFileSync(`public/data/${path}`)));
    } catch {
      return Promise.resolve(new Response('no', { status: 404 }));
    }
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function draw(width: number, chamber: Chamber): Promise<SVGSVGElement> {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  const { loadIndex, loadOutlines } = await import('../../src/client/entities/state');
  const { createUsMap } = await import('../../src/client/widgets/us-map');
  const [index, outlines] = await Promise.all([loadIndex(), loadOutlines()]);
  const map = createUsMap({ outlines, index, chamber });
  const el = map.el.querySelector('svg');
  map.destroy();
  if (!el) throw new Error('no svg');
  return el;
}

interface Ink {
  abbr: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * The ink of each in-state label, worked out from the type rather than from the widget's own spacing: capitals and
 * figures stand 0.72 em, a letter is 0.7 em wide and a figure 0.6 em, at the sizes and offsets the label is set with.
 */
function inkOf(root: SVGSVGElement): Ink[] {
  const compact = root.classList.contains('strv-us--compact');
  const style = root.getAttribute('style') ?? '';
  const A = compact ? Number(/--us-abbr:\s*(\d+)px/.exec(style)![1]) : 13;
  const S = compact ? Number(/--us-seats:\s*(\d+)px/.exec(style)![1]) : 24;
  return [...root.querySelectorAll('.strv-us__label')].map((t) => {
    const x = Number(t.getAttribute('x'));
    const y = Number(t.getAttribute('y'));
    const [abbr = '', seats = ''] = [...t.querySelectorAll('tspan')].map((s) => s.textContent ?? '');
    const abbrBase = y + (compact ? -0.2 : -0.35) * A;
    const seatsBase = abbrBase + (compact ? 1.05 : 1.15) * S;
    const w = Math.max(abbr.length * 0.7 * A, seats.length * 0.6 * S);
    return { abbr, x0: x - w / 2, x1: x + w / 2, y0: abbrBase - 0.72 * A, y1: seatsBase };
  });
}

const height = (root: SVGSVGElement): number => Number(root.getAttribute('viewBox')!.split(' ')[3]);

describe('national map labels', () => {
  for (const chamber of ['federal-house', 'state-house', 'state-senate'] as const) {
    for (const width of [360, 390, 430, 599, 1280]) {
      it(`never overlap, and every state gets a label or a callout (${chamber}, ${width}px)`, async () => {
        const root = await draw(width, chamber);
        const ink = inkOf(root);
        for (let i = 0; i < ink.length; i++) {
          for (let j = i + 1; j < ink.length; j++) {
            const a = ink[i]!;
            const b = ink[j]!;
            const apart = a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0;
            expect(apart, `${a.abbr} and ${b.abbr} overlap`).toBe(true);
          }
        }
        const states = [...root.querySelectorAll('.strv-us__state')].map((n) => n.getAttribute('data-abbr'));
        const labeled = ink.map((l) => l.abbr);
        const called = [...root.querySelectorAll('.strv-us__callout .strv-us__abbr-ink')].map((n) => n.textContent);
        expect(called.filter((c) => labeled.includes(c ?? ''))).toEqual([]);
        expect([...labeled, ...called].sort()).toEqual([...states].sort());
        expect(labeled).not.toContain('NC');
        // Each label is a second link to its own state.
        for (const link of root.querySelectorAll('.strv-us__label-link')) {
          const abbr = link.getAttribute('data-abbr');
          expect(link.querySelector('.strv-us__abbr')!.textContent).toBe(abbr);
          expect(link.getAttribute('href')).toBe(root.querySelector(`.strv-us__state[data-abbr="${abbr}"]`)!.getAttribute('href'));
        }
        // The drawing is tall enough for the lowest callout.
        const ys = [...root.querySelectorAll('.strv-us__callout')].map((n) => Number(n.getAttribute('y')));
        if (ys.length > 0) expect(height(root)).toBeGreaterThan(Math.max(...ys));
      });
    }
  }

  it('grows the drawing on a phone when the callout column runs past it', async () => {
    expect(height(await draw(390, 'federal-house'))).toBeGreaterThan(600);
  });
});

describe('national map highlight', () => {
  it('lights a state and its label together while pointed at', async () => {
    const root = await draw(1280, 'federal-house');
    const label = root.querySelector('.strv-us__label-link[data-abbr="TX"] text')!;
    const both = [...root.querySelectorAll('[data-abbr="TX"]')];
    expect(both).toHaveLength(2);
    label.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(both.every((n) => n.classList.contains('is-hover'))).toBe(true);
    label.dispatchEvent(new Event('pointerout', { bubbles: true }));
    expect(both.some((n) => n.classList.contains('is-hover'))).toBe(false);
  });

  it('keeps a keyboard-focused state lit when the pointer leaves it', async () => {
    const root = await draw(1280, 'federal-house');
    vi.spyOn(Element.prototype, 'matches').mockImplementation((sel: string) => sel === ':focus-visible');
    const state = root.querySelector('.strv-us__state[data-abbr="TX"]')!;
    const both = [...root.querySelectorAll('[data-abbr="TX"]')];
    state.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    state.dispatchEvent(new Event('pointerover', { bubbles: true }));
    state.dispatchEvent(new Event('pointerout', { bubbles: true }));
    expect(both.every((n) => n.classList.contains('is-focus'))).toBe(true);
    state.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(both.some((n) => n.classList.contains('is-focus'))).toBe(false);
  });

  it('does not light or unlight a state for focus a mouse press gave it', async () => {
    const root = await draw(1280, 'federal-house');
    vi.spyOn(Element.prototype, 'matches').mockReturnValue(false);
    const state = root.querySelector('.strv-us__state[data-abbr="TX"]')!;
    const both = [...root.querySelectorAll('[data-abbr="TX"]')];
    state.dispatchEvent(new Event('pointerover', { bubbles: true }));
    state.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(both.every((n) => n.classList.contains('is-hover'))).toBe(true);
    expect(both.some((n) => n.classList.contains('is-focus'))).toBe(false);
  });
});
