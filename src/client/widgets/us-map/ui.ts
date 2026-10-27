import { geoAlbersUsa, geoPath } from 'd3-geo';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { svg, mountCreditStrip, loadPublishedVersions, type Versions, routeHref, stateRoute, labelPoint, pointInPolygonRings, districtCount, chamberLabel, type Chamber } from '../../shared';
import { chamberView, isGeneratedIn, type StateIndex } from '../../entities/state';

export interface UsMapOptions {
  outlines: FeatureCollection<Polygon | MultiPolygon, { abbr: string; name: string }>;
  index: StateIndex;
  /** The chamber whose maps are shown; the federal House when omitted. */
  chamber?: Chamber;
}

const W = 960;
const H = 600;

/** Coastal states whose own label would sit on the shoreline get a callout too. */
const ALWAYS_CALLOUT = new Set(['NC']);

/** On a phone, the share of a moved label's width that must lie inside its state (see buildUsMap). */
const MOVED_CORE = 0.4;
/** Clear space kept between two labels on a phone, in drawing units. */
const GAP_COMPACT = 2;

/** The rightmost projected vertex of a state: a point on its eastern edge for a leader to start from. */
function eastEdge(geometry: Polygon | MultiPolygon, project: (p: [number, number]) => [number, number] | null): [number, number] | null {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let best: [number, number] | null = null;
  for (const poly of polys) {
    for (const p of poly[0] ?? []) {
      const q = project(p as [number, number]);
      if (q && (!best || q[0] > best[0])) best = q;
    }
  }
  return best;
}

/** The largest part of a state, projected: its rings in drawing units. */
function largestPart(geometry: Polygon | MultiPolygon, project: (p: [number, number]) => [number, number] | null): [number, number][][] {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let best: [number, number][][] = [];
  let bestSpan = -1;
  for (const poly of polys) {
    const rings = poly.map((ring) => ring.map((p) => project(p as [number, number])).filter((q): q is [number, number] => q !== null));
    const outer = rings[0] ?? [];
    if (outer.length < 3) continue;
    const xs = outer.map((q) => q[0]);
    const ys = outer.map((q) => q[1]);
    const span = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    if (span > bestSpan) {
      bestSpan = span;
      best = rings;
    }
  }
  return best;
}

/**
 * Whether a label box of `w` by `h` drawing units, set at (x, y) the way the
 * labels are (the code above the point, the seat count below it), lies wholly
 * inside the state's main part.
 */
function labelFits(rings: [number, number][][], x: number, y: number, w: number, top: number, bottom: number, coreOnly = false): boolean {
  if (rings.length === 0) return false;
  for (const fx of [-0.5, 0, 0.5]) {
    for (const fy of coreOnly ? [0.5] : [0, 0.5, 1]) {
      if (!pointInPolygonRings([x + fx * w, y - top + fy * (top + bottom)], rings)) return false;
    }
  }
  return true;
}

/**
 * The national index map: every state in outline, states with a generated
 * map set in ink with their number of seats. Small states get a label in a
 * column to the east, joined by a hairline.
 */
function buildUsMap(opts: UsMapOptions, compact: boolean): SVGSVGElement {
  // On a phone the drawing is shown at about 37% of its width, so labels are set in larger units
  // and the callout column is wider; the CSS sizes them so they read at 12 px or more on screen.
  const colW = compact ? 132 : 96;
  // The drawing is scaled to the screen width (the page keeps a 1 rem gutter each side); label units are chosen so state codes
  // measure 12.5 px and seat counts 13.5 px on screen however narrow the phone.
  const scale = Math.max(0.28, (window.innerWidth - 32) / W);
  const abbrUnits = Math.ceil(12.5 / scale);
  const seatsUnits = Math.ceil(13.5 / scale);
  const projection = geoAlbersUsa().fitExtent(
    [
      [8, 8],
      [W - colW, H - 8],
    ],
    opts.outlines,
  );
  const path = geoPath(projection);
  const chamber = opts.chamber ?? 'federal-house';
  const byAbbr = new Map(opts.index.states.map((s) => [s.abbr, s]));

  const quiet = svg('g', { class: 'strv-us__quiet', 'aria-hidden': 'true' });
  const active = svg('g', { class: 'strv-us__active' });
  const labels = svg('g', { class: 'strv-us__labels', 'aria-hidden': 'true' });
  const callouts: { y: number; cx: number; cy: number; abbr: string; seats: number }[] = [];

  // Every label is placed before any is drawn, so a label can step aside for a neighbor's instead of landing on it.
  interface Box {
    x0: number;
    x1: number;
    y0: number;
    y1: number;
  }
  interface Pending {
    d: string;
    abbr: string;
    seats: number;
    href: string;
    label: string;
    geometry: Polygon | MultiPolygon;
    /** Spots inside the state where the label fits, nearest its usual place first. */
    spots: [number, number][];
    w: number;
    top: number;
    bottom: number;
  }
  const project = (p: [number, number]): [number, number] | null => projection(p);
  const abbrSize = compact ? abbrUnits : 13;
  const seatsSize = compact ? seatsUnits : 24;
  // On a phone the labels are large against the drawing: a label may run past a state's edge there (its ink outline keeps it
  // readable on the ground), as long as the middle of it is inside. A long leader across the country would read worse.
  const k = compact ? 0.72 : 1;
  const top = abbrSize * (compact ? 0.95 : 1.1) + 2;
  const bottom = seatsSize * (compact ? 0.85 : 0.95) + 2;
  const pending: Pending[] = [];

  for (const f of opts.outlines.features) {
    const d = path(f);
    if (!d) continue;
    const entry = byAbbr.get(f.properties.abbr);
    if (!entry || !isGeneratedIn(entry, chamber)) {
      quiet.append(svg('path', { d }));
      continue;
    }
    // The usual spot is the point of the state's main part farthest from its edges (Michigan's lower peninsula, not the lake).
    const [cx, cy] = project(labelPoint(f.geometry) as [number, number]) ?? path.centroid(f);
    const seats = chamberView(entry, chamber).seats;
    const w = Math.max(abbrSize * 1.6, String(seats).length * seatsSize * 0.62) + 4;
    const rings = largestPart(f.geometry, project);
    const fitsAt = (x: number, y: number): boolean => labelFits(rings, x, y, w * k, top, bottom, compact);
    const spots: [number, number][] = [];
    if (!ALWAYS_CALLOUT.has(entry.abbr) && fitsAt(cx, cy)) {
      spots.push([cx, cy]);
      // Other spots on a grid across the state, for when a neighbor's label takes the usual one.
      const outer = rings[0] ?? [];
      const xs = outer.map((q) => q[0]);
      const ys = outer.map((q) => q[1]);
      const step = Math.max(4, (top + bottom) / 4);
      const more: [number, number][] = [];
      // On a phone a moved label needs only its middle inside the state: its ink outline keeps it readable on the neighbor.
      const fitsMoved = compact ? (x: number, y: number): boolean => labelFits(rings, x, y, w * MOVED_CORE, top, bottom, true) : fitsAt;
      for (let y = Math.min(...ys); y <= Math.max(...ys); y += step) {
        for (let x = Math.min(...xs); x <= Math.max(...xs); x += step) if (fitsMoved(x, y)) more.push([x, y]);
      }
      more.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
      spots.push(...more);
    }
    pending.push({ d, abbr: entry.abbr, seats, href: routeHref(stateRoute(entry.abbr, { chamber })), label: `${entry.name}, ${districtCount(seats)}`, geometry: f.geometry, spots, w, top, bottom });
  }

  // The states with the fewest spots choose first; each takes its nearest spot whose label clears every label already placed.
  // When none is clear, the labels in the way may each move to another of their own spots to make room. A state still left
  // without a clear spot gets a callout instead.
  const gap = compact ? GAP_COMPACT : 3;
  const spotOf = new Map<string, [number, number]>();
  const boxOf = new Map<string, Box>();
  const byPending = new Map(pending.map((p) => [p.abbr, p]));
  const boxAt = (p: Pending, [x, y]: [number, number]): Box => ({ x0: x - p.w / 2 - gap, x1: x + p.w / 2 + gap, y0: y - p.top - gap, y1: y + p.bottom + gap });
  const meets = (a: Box, b: Box): boolean => !(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0);
  const inTheWay = (b: Box, except: ReadonlySet<string> = new Set()): string[] => [...boxOf].filter(([abbr, o]) => !except.has(abbr) && meets(b, o)).map(([abbr]) => abbr);
  const place = (p: Pending, spot: [number, number]): void => {
    spotOf.set(p.abbr, spot);
    boxOf.set(p.abbr, boxAt(p, spot));
  };
  for (const p of [...pending].filter((q) => q.spots.length > 0).sort((a, b) => a.spots.length - b.spots.length || (a.abbr < b.abbr ? -1 : 1))) {
    const free = p.spots.find((q) => inTheWay(boxAt(p, q)).length === 0);
    if (free) {
      place(p, free);
      continue;
    }
    for (const spot of p.spots) {
      const mine = boxAt(p, spot);
      const blockers = inTheWay(mine);
      if (blockers.length > 2) continue;
      // Move each blocker to its nearest spot that clears this label, the other blockers' new places and everything else.
      const moved = new Map<string, Box>();
      const moves: [Pending, [number, number]][] = [];
      for (const abbr of blockers) {
        const other = byPending.get(abbr)!;
        const to = other.spots.find((q) => {
          const b = boxAt(other, q);
          return !meets(b, mine) && [...moved.values()].every((m) => !meets(b, m)) && inTheWay(b, new Set(blockers)).length === 0;
        });
        if (!to) break;
        moved.set(abbr, boxAt(other, to));
        moves.push([other, to]);
      }
      if (moves.length !== blockers.length) continue;
      for (const [other, to] of moves) place(other, to);
      place(p, spot);
      break;
    }
  }

  for (const p of pending) {
    const spot = spotOf.get(p.abbr);
    active.append(svg('a', { href: p.href, 'aria-label': p.label, class: 'strv-us__state', 'data-abbr': p.abbr }, svg('title', null, p.label), svg('path', { d: p.d })));
    // Labels are drawn above every state, not inside their own, so a label that runs past its edge is never painted over by
    // the neighbor drawn after it. Each is a second, unfocusable link to its state; the two light up together (see below).
    if (spot) {
      labels.append(
        svg(
          'a',
          { href: p.href, tabindex: -1, class: 'strv-us__label-link', 'data-abbr': p.abbr },
          svg(
            'text',
            { x: spot[0], y: spot[1], class: 'strv-us__label', 'text-anchor': 'middle' },
            svg('tspan', { x: spot[0], dy: compact ? '-0.2em' : '-0.35em', class: 'strv-us__abbr' }, p.abbr),
            svg('tspan', { x: spot[0], dy: compact ? '1.05em' : '1.15em', class: 'strv-us__seats' }, String(p.seats)),
          ),
        ),
      );
    }
    if (!spot) {
      const [ax, ay] = eastEdge(p.geometry, project) ?? [0, 0];
      callouts.push({ y: ay, cx: ax, cy: ay, abbr: p.abbr, seats: p.seats });
    }
  }

  // Stack the callouts in a column on the east edge, keeping their order north to south.
  callouts.sort((a, b) => a.y - b.y);
  const colX = W - (compact ? 110 : 78);
  let lastY = -Infinity;
  for (const c of callouts) {
    const y = Math.max(c.y, lastY + (compact ? 38 : 26));
    lastY = y;
    labels.append(
      svg('path', { d: `M${c.cx},${c.cy}L${colX - 30},${y}H${colX - 6}`, class: 'strv-us__leader' }),
      svg('circle', { cx: c.cx, cy: c.cy, r: 2.5, class: 'strv-us__dot' }),
      // A larger click target for small states; the state shape itself is the keyboard stop.
      svg(
        'a',
        { href: routeHref(stateRoute(c.abbr, { chamber })), tabindex: -1, class: 'strv-us__callout-link' },
        svg('rect', { x: colX - 8, y: y - (compact ? 18 : 12), width: compact ? 116 : 78, height: compact ? 36 : 24, class: 'strv-us__hit' }),
        svg('text', { x: colX, y, class: 'strv-us__callout', 'dominant-baseline': 'middle' }, svg('tspan', { class: 'strv-us__abbr-ink' }, c.abbr), svg('tspan', { dx: compact ? 10 : 6, class: 'strv-us__seats-ink' }, String(c.seats))),
      ),
    );
  }

  const root = svg(
    'svg',
    {
      class: compact ? 'strv-us strv-us--compact' : 'strv-us',
      style: compact ? `--us-abbr:${abbrUnits}px;--us-seats:${seatsUnits}px` : null,
      // A long callout column (large phone labels) can run past the drawing; the box grows to hold it so it never overlaps what follows.
      viewBox: `0 0 ${W} ${Math.max(H, Math.ceil(lastY + (compact ? 20 : 14)))}`,
      role: 'group',
      'aria-label': chamber === 'federal-house' ? 'Map of the United States. States with a generated map are links, labeled with their number of districts.' : `Map of the United States. States with a generated ${chamberLabel(chamber)} map are links, labeled with their number of districts.`,
    },
    quiet,
    active,
    labels,
  );
  // A state and its label are separate links; pointing at or focusing either lights up both.
  const hot = (e: Event, on: boolean): void => {
    const abbr = (e.target as Element | null)?.closest?.('[data-abbr]')?.getAttribute('data-abbr');
    if (!abbr) return;
    for (const n of root.querySelectorAll(`[data-abbr="${abbr}"]`)) n.classList.toggle('is-hot', on);
  };
  root.addEventListener('pointerover', (e) => hot(e, true));
  root.addEventListener('pointerout', (e) => hot(e, false));
  root.addEventListener('focusin', (e) => hot(e, (e.target as Element).matches(':focus-visible')));
  root.addEventListener('focusout', (e) => hot(e, false));
  return root;
}

/** Below this width the map is drawn with larger labels (see buildUsMap). */
const COMPACT_BELOW = 600;

export interface UsMap {
  el: HTMLElement;
  destroy(): void;
}

/**
 * The national map, wrapped so it can redraw its labels when the screen
 * crosses the phone width (a phone turned on its side, a window resized).
 */
export function createUsMap(opts: UsMapOptions): UsMap {
  const el = document.createElement('div');
  el.className = 'strv-us-wrap';
  let mode: boolean | null = null;
  const draw = (): void => {
    const compact = window.innerWidth < COMPACT_BELOW;
    if (compact === mode) return;
    mode = compact;
    const next = buildUsMap(opts, compact);
    const current = el.querySelector('svg');
    if (current) current.replaceWith(next);
    else el.prepend(next);
  };
  draw();
  let published: Versions | null = null;
  const credit = mountCreditStrip(el, () => (published ? { versions: published } : {}));
  let gone = false;
  void loadPublishedVersions().then((v) => {
    if (v === null || gone) return;
    published = v;
    credit.update();
  });
  window.addEventListener('resize', draw);
  return {
    el,
    destroy: () => {
      window.removeEventListener('resize', draw);
      gone = true;
      credit.destroy();
    },
  };
}
