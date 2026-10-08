import { h, svg, formatHash, prefersReducedMotion, stateRoute } from '../../shared';
import type { RuleCase } from '../../entities/rule-example';
import { drawChart, updateChart } from './chart';
import { createPlayer } from './player';

type Pts = readonly (readonly [number, number])[];

/** How long a shape takes to glide to its new points. */
const TWEEN_MS = 600;
/** Rough width of one label character at the label size, in view units. */
const CHAR_W = 7;
const PAD = 8;

export interface RuleDemo {
  el: HTMLElement;
  play(): void;
  pause(): void;
  /** Whether the panel is advancing on its own; false once it reaches the last step or is paused. */
  readonly playing: boolean;
  step(i: number, announce: boolean): void;
  destroy(): void;
}

const round = (n: number): number => Math.round(n * 100) / 100;
const pointsAttr = (pts: Pts): string => pts.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');

/** Breaks text to lines of at most `max` characters, at spaces where it can and mid-word where it must. */
function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    let w = word;
    while (w.length > max) {
      if (line) {
        lines.push(line);
        line = '';
      }
      lines.push(w.slice(0, max));
      w = w.slice(max);
    }
    if (!line) line = w;
    else if (line.length + 1 + w.length <= max) line += ` ${w}`;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function linkOf(c: RuleCase): HTMLAnchorElement {
  const { state, cut, move } = c.link;
  const name = c.stateName;
  const patch: { cut?: number; move?: number } = {};
  if (cut !== undefined) patch.cut = cut;
  else if (move !== undefined) patch.move = move;
  const what = cut !== undefined ? ` at cut ${cut}` : move !== undefined ? ` at balancing move ${move}` : '';
  return h('a', { class: 'strv-rule-demo__link', href: formatHash(stateRoute(state, patch)) }, `Open ${name}${what}`);
}

interface Shape {
  el: SVGElement;
  start: Pts;
  /** The points now on screen. */
  now: Pts;
}

/**
 * One animated panel: the case's shapes and labels, a caption per step, and controls. Under reduced motion
 * it never plays by itself and every change lands at once.
 */
export function createRuleDemo(c: RuleCase): RuleDemo {
  const caption = h('p', { class: 'strv-rule-demo__caption', 'aria-live': 'off' });
  const fig = h('figure', { class: 'strv-rule-demo', 'data-case': c.id });

  if (c.missing !== undefined) {
    caption.textContent = c.steps[0]!.caption;
    fig.classList.add('strv-rule-demo--missing');
    fig.append(caption);
    return { el: fig, play() {}, pause() {}, playing: false, step() {}, destroy() {} };
  }

  const shapes = new Map<string, Shape>();
  const labels = new Map<string, SVGElement>();
  const { w, h: vh } = c.view;
  const frame = svg('svg', { class: 'strv-dg strv-rule-demo__svg', viewBox: `0 0 ${w} ${vh}`, 'aria-hidden': 'true', focusable: 'false' });

  for (const b of c.blocks ?? []) {
    const el = svg('polygon', {
      class: 'strv-dg__block strv-rule-demo__off',
      'data-id': b.id,
      'data-tag': b.tag,
      'data-side': b.side,
      'data-district': b.district,
      points: pointsAttr(b.ring),
    });
    shapes.set(b.id, { el, start: b.ring, now: b.ring });
    frame.append(el);
  }
  for (const l of c.lines ?? []) {
    const el = svg('polyline', { class: 'strv-dg__border strv-rule-demo__line strv-rule-demo__off', 'data-id': l.id, 'data-tag': l.tag, points: pointsAttr(l.pts) });
    shapes.set(l.id, { el, start: l.pts, now: l.pts });
    frame.append(el);
  }
  const chartEl = c.chart ? drawChart(c.chart, c.view) : undefined;
  if (chartEl) frame.append(chartEl);
  for (const l of c.labels ?? []) {
    const room = Math.max(Math.min(l.x, w - l.x) * 2 - PAD * 2, CHAR_W * 8);
    const lines = wrap(l.text, Math.floor(room / CHAR_W));
    const el = svg(
      'text',
      { class: 'strv-dg__t strv-rule-demo__label strv-rule-demo__off', 'data-id': l.id, 'data-tag': l.tag, x: l.x, y: l.y, 'text-anchor': 'middle' },
      lines.map((t, i) => svg('tspan', { x: l.x, dy: i === 0 ? 0 : '1.25em' }, t)),
    );
    labels.set(l.id, el);
    frame.append(el);
  }

  // What is on screen at a step, rebuilt from the steps up to it so Previous and Next agree.
  const stateAt = (i: number): { show: Set<string>; marks: Map<string, string>; pts: Map<string, Pts> } => {
    const pts = new Map<string, Pts>();
    const marks = new Map<string, string>();
    for (let k = 0; k <= i; k++) {
      const s = c.steps[k]!;
      for (const [id, v] of Object.entries(s.set ?? {})) marks.set(id, v);
      for (const t of s.tween ?? []) pts.set(t.id, t.to);
    }
    const s = c.steps[i]!;
    const visible = new Set(s.show);
    for (const id of s.hide ?? []) visible.delete(id);
    return { show: visible, marks, pts };
  };

  let raf = 0;
  let endTween: (() => void) | null = null;
  const draw = (id: string, pts: Pts): void => {
    const sh = shapes.get(id)!;
    sh.now = pts;
    sh.el.setAttribute('points', pointsAttr(pts));
  };
  /** Cancels a glide in flight and lands its shapes on their end points. */
  const settle = (): void => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    endTween?.();
    endTween = null;
  };

  function apply(i: number, animate: boolean): void {
    settle();
    const { show: visible, marks, pts } = stateAt(i);
    const els: [string, SVGElement][] = [...[...shapes].map(([k, s]): [string, SVGElement] => [k, s.el]), ...labels];
    for (const [id, el] of els) {
      el.classList.toggle('strv-rule-demo__off', !visible.has(id));
      const m = marks.get(id);
      if (m === undefined) el.removeAttribute('data-state');
      else el.setAttribute('data-state', m);
    }
    const moves: { id: string; from: Pts; to: Pts }[] = [];
    for (const [id, sh] of shapes) {
      const to = pts.get(id) ?? sh.start;
      if (to === sh.now) continue;
      if (animate && to.length === sh.now.length) moves.push({ id, from: sh.now, to });
      else draw(id, to);
    }
    const glide = chartEl ? updateChart(chartEl, visible, animate) : undefined;
    if (!moves.length && !glide) return;
    const t0 = performance.now();
    endTween = () => {
      for (const m of moves) draw(m.id, m.to);
      glide?.end();
    };
    const tick = (): void => {
      const t = Math.min((performance.now() - t0) / TWEEN_MS, 1);
      if (t >= 1) {
        raf = 0;
        endTween?.();
        endTween = null;
        return;
      }
      const e = t * t * (3 - 2 * t);
      for (const m of moves) {
        const cur = m.from.map(([x, y], k) => [x + (m.to[k]![0] - x) * e, y + (m.to[k]![1] - y) * e] as const);
        shapes.get(m.id)!.el.setAttribute('points', pointsAttr(cur));
      }
      glide?.frame(e);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  const count = h('span', { class: 'strv-rule-demo__count' });
  const btn = (label: string, text: string, onclick: () => void): HTMLButtonElement =>
    h('button', { type: 'button', class: 'strv-button strv-rule-demo__btn', 'aria-label': label, onclick }, text);

  const onStep = (i: number, announce: boolean): void => {
    apply(i, !prefersReducedMotion());
    caption.textContent = c.steps[i]!.caption;
    caption.setAttribute('aria-live', announce ? 'polite' : 'off');
    count.textContent = `Step ${i + 1} of ${c.steps.length}`;
    // aria-disabled, not disabled: a button the visitor just pressed keeps focus at the end of the steps.
    prev.setAttribute('aria-disabled', String(i === 0));
    next.setAttribute('aria-disabled', String(i === c.steps.length - 1));
    sync();
  };
  const player = createPlayer(c.steps.length, onStep);
  const prev = btn('Previous step', 'Previous', () => {
    if (prev.getAttribute('aria-disabled') !== 'true') player.prev();
  });
  const next = btn('Next step', 'Next', () => {
    if (next.getAttribute('aria-disabled') !== 'true') player.next();
  });
  const toggle = btn('Play', 'Play', () => {
    if (player.playing) player.pause();
    else player.play();
    sync();
  });
  function sync(): void {
    const label = player.playing ? 'Pause' : 'Play';
    toggle.setAttribute('aria-label', label);
    toggle.textContent = label;
  }

  fig.append(frame, h('div', { class: 'strv-rule-demo__bar' }, prefersReducedMotion() ? null : toggle, prev, next, count), caption, linkOf(c));
  onStep(0, false);

  return {
    el: fig,
    get playing() {
      return player.playing;
    },
    play() {
      player.play();
      sync();
    },
    pause() {
      player.pause();
      sync();
    },
    step(i, announce) {
      player.pause();
      player.goTo(i, announce);
    },
    destroy() {
      player.destroy();
      settle();
    },
  };
}
