import { svg } from '../../shared';
import type { RuleCase } from '../../entities/rule-example';

type Chart = NonNullable<RuleCase['chart']>;
type View = { readonly w: number; readonly h: number };

/** A glide the widget runs alongside its own: `frame` gets the eased progress 0..1, `end` lands it. */
export interface ChartTween {
  frame(e: number): void;
  end(): void;
}

interface Handle {
  update(visible: ReadonlySet<string>, animate: boolean): ChartTween | undefined;
}

/** The plot area, in view units: side margin, room above for a label, room below for bar names and an axis label. */
const SIDE = 8;
const TOP = 18;
const FOOT = 26;
/** A mark class with at most this many marks is drawn thicker so it can be found. */
const FEW = 12;

const handles = new WeakMap<SVGGElement, Handle>();
const r2 = (n: number): number => Math.round(n * 100) / 100;

interface Box {
  readonly l: number;
  readonly r: number;
  readonly t: number;
  readonly b: number;
}

/** Which mark class each value is drawn in right now: the last visible class that lists it, else none (0). */
function classes(chart: Chart, names: readonly string[], visible: ReadonlySet<string>): Int16Array {
  const cls = new Int16Array(chart.values.length);
  names.forEach((name, n) => {
    if (!visible.has(`chart-${name}`)) return;
    for (const i of chart.marks![name]!) cls[i] = n + 1;
  });
  return cls;
}

function stripOf(g: SVGGElement, chart: Chart, names: readonly string[], box: Box): Handle {
  const n = chart.values.length;
  const max = chart.values.reduce((a, v) => Math.max(a, v), 0) || 1;
  const slot = (box.r - box.l) / n;
  const xAt = (pos: number): number => r2(box.l + (pos + 0.5) * slot);
  const home = Float64Array.from({ length: n }, (_, i) => xAt(i));
  const sorted = new Float64Array(n);
  // Shortest first; equal values keep their angle order.
  Array.from({ length: n }, (_, i) => i)
    .sort((a, b) => chart.values[a]! - chart.values[b]! || a - b)
    .forEach((i, pos) => { sorted[i] = xAt(pos); });
  const top = chart.values.map((v) => r2(box.b - (v / max) * (box.b - box.t)));

  const classNames = ['base', ...names];
  // Marks that are few get thick ticks, each class thinner than the one before it, so two neighboring ones
  // (a skipped line and the one used after it) show as a wide tick with a narrower one drawn over it.
  const few = names.filter((name) => chart.marks![name]!.length <= FEW);
  const paths = classNames.map((name, c) => {
    const j = few.indexOf(name);
    const width = j >= 0 ? 2 * (few.length - j) + 1 : c === 0 ? slot : slot * 2;
    return svg('path', { class: 'strv-chart__ticks', 'data-mark': name, fill: 'none', 'stroke-width': r2(width) });
  });
  const axis = svg('path', { class: 'strv-chart__axis', d: `M${box.l} ${box.b}H${box.r}` });
  g.append(axis, ...paths);

  const cur = Float64Array.from(home);
  let cls: Int16Array = new Int16Array(n);
  let isSorted = false;
  const render = (): void => {
    const d: string[][] = classNames.map(() => []);
    for (let i = 0; i < n; i++) d[cls[i]!]!.push(`M${r2(cur[i]!)} ${box.b}V${top[i]}`);
    paths.forEach((p, c) => p.setAttribute('d', d[c]!.join('')));
  };
  render();

  return {
    update(visible, animate) {
      cls = classes(chart, names, visible);
      const wantSorted = visible.has('chart-sorted');
      if (wantSorted === isSorted) {
        render();
        return undefined;
      }
      isSorted = wantSorted;
      const to = wantSorted ? sorted : home;
      if (!animate) {
        cur.set(to);
        render();
        return undefined;
      }
      const from = Float64Array.from(cur);
      render();
      return {
        frame(e) {
          for (let i = 0; i < n; i++) cur[i] = from[i]! + (to[i]! - from[i]!) * e;
          render();
        },
        end() {
          cur.set(to);
          render();
        },
      };
    },
  };
}

/** The y of a value in a plot that always includes zero, and the y of zero. */
function scaleOf(values: readonly number[], box: Box): { y: (v: number) => number; zero: number } {
  const lo = values.reduce((a, v) => Math.min(a, v), 0);
  const hi = values.reduce((a, v) => Math.max(a, v), 0);
  const span = hi - lo || 1;
  const y = (v: number): number => r2(box.b - ((v - lo) / span) * (box.b - box.t));
  return { y, zero: y(0) };
}

function barsOf(g: SVGGElement, chart: Chart, names: readonly string[], box: Box, view: View): Handle {
  const n = chart.values.length;
  const base = chart.baseline ?? 0;
  const dev = chart.values.map((v) => v - base);
  const { y, zero } = scaleOf(dev, box);
  const slot = (box.r - box.l) / n;
  const width = Math.min(slot * 0.6, 40);
  g.append(svg('path', { class: 'strv-chart__axis', d: `M${box.l} ${zero}H${box.r}` }));
  const bars = dev.map((v, i) => {
    const edge = y(v);
    // A bar that is almost nothing still gets a sliver, so a district exactly on the line is not missing.
    const height = Math.max(Math.abs(edge - zero), 1.5);
    const bar = svg('rect', {
      class: 'strv-chart__bar',
      x: r2(box.l + slot * i + (slot - width) / 2),
      y: v < 0 ? zero : r2(zero - height),
      width: r2(width),
      height: r2(height),
    });
    g.append(bar);
    return bar;
  });
  (chart.labels ?? []).forEach((text, i) => {
    g.append(svg('text', { class: 'strv-dg__t strv-chart__label', x: r2(box.l + slot * (i + 0.5)), y: view.h - 10, 'text-anchor': 'middle' }, text));
  });
  return {
    update(visible) {
      const cls = classes(chart, names, visible);
      bars.forEach((bar, i) => {
        if (cls[i]) bar.setAttribute('data-mark', names[cls[i]! - 1]!);
        else bar.removeAttribute('data-mark');
      });
      return undefined;
    },
  };
}

function seriesOf(g: SVGGElement, chart: Chart, names: readonly string[], box: Box): Handle {
  const n = chart.values.length;
  const { y, zero } = scaleOf(chart.values, box);
  const x = (i: number): number => r2(n === 1 ? (box.l + box.r) / 2 : box.l + (i / (n - 1)) * (box.r - box.l));
  g.append(
    svg('path', { class: 'strv-chart__axis', d: `M${box.l} ${zero}H${box.r}` }),
    svg('path', { class: 'strv-chart__line', fill: 'none', d: chart.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)} ${y(v)}`).join('') }),
  );
  const dots = chart.values.map((v, i) => {
    const dot = svg('circle', { class: 'strv-chart__dot', cx: x(i), cy: y(v), r: 3 });
    g.append(dot);
    return dot;
  });
  return {
    update(visible) {
      const cls = classes(chart, names, visible);
      dots.forEach((dot, i) => {
        if (cls[i]) dot.setAttribute('data-mark', names[cls[i]! - 1]!);
        else dot.removeAttribute('data-mark');
      });
      return undefined;
    },
  };
}

/**
 * A case's chart as one group (`data-id="chart"`). Its mark classes switch on with the ids `chart-<name>`; on a
 * strip, the id `chart-sorted` puts the marks in order of value. A strip draws one path per class, not one
 * element per mark, so a strip of 1,800 marks stays light and the sort glide only rewrites those paths.
 */
export function drawChart(chart: Chart, view: View): SVGGElement {
  const g = svg('g', { class: 'strv-chart strv-rule-demo__off', 'data-id': 'chart', 'data-kind': chart.kind });
  const box: Box = { l: SIDE, r: view.w - SIDE, t: TOP, b: view.h - FOOT };
  const names = Object.keys(chart.marks ?? {});
  const handle = chart.kind === 'strip' ? stripOf(g, chart, names, box) : chart.kind === 'bars' ? barsOf(g, chart, names, box, view) : seriesOf(g, chart, names, box);
  handle.update(new Set(), false);
  handles.set(g, handle);
  return g;
}

/** Puts the chart in the state a step shows (ids in `visible`); returns a glide to run when it moves marks. */
export function updateChart(g: SVGGElement, visible: ReadonlySet<string>, animate: boolean): ChartTween | undefined {
  g.classList.toggle('strv-rule-demo__off', !visible.has('chart'));
  return handles.get(g)?.update(visible, animate);
}
