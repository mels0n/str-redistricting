import { geoAlbersUsa, geoPath } from 'd3-geo';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { svg, formatHash, stateRoute, labelPoint, pointInPolygonRings, districtCount } from '../../shared';
import { isGenerated, type StateIndex } from '../../entities/state';

export interface UsMapOptions {
  outlines: FeatureCollection<Polygon | MultiPolygon, { abbr: string; name: string }>;
  index: StateIndex;
}

const W = 960;
const H = 600;

/** Coastal states whose own label would sit on the shoreline get a callout too. */
const ALWAYS_CALLOUT = new Set(['NC']);

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
  const byAbbr = new Map(opts.index.states.map((s) => [s.abbr, s]));

  const quiet = svg('g', { class: 'strv-us__quiet', 'aria-hidden': 'true' });
  const active = svg('g', { class: 'strv-us__active' });
  const labels = svg('g', { class: 'strv-us__labels', 'aria-hidden': 'true' });
  const callouts: { y: number; cx: number; cy: number; abbr: string; seats: number }[] = [];

  for (const f of opts.outlines.features) {
    const d = path(f);
    if (!d) continue;
    const entry = byAbbr.get(f.properties.abbr);
    if (!entry || !isGenerated(entry)) {
      quiet.append(svg('path', { d }));
      continue;
    }
    // The label sits at the point of the state's main part farthest from its edges (Michigan's lower peninsula, not the lake).
    const project = (p: [number, number]): [number, number] | null => projection(p);
    const [cx, cy] = project(labelPoint(f.geometry) as [number, number]) ?? path.centroid(f);
    const abbrSize = compact ? abbrUnits : 13;
    const seatsSize = compact ? seatsUnits : 24;
    const href = formatHash(stateRoute(entry.abbr));
    const label = `${entry.name}, ${districtCount(entry.seats)}`;
    const labelW = Math.max(abbrSize * 1.6, String(entry.seats).length * seatsSize * 0.62) + 4;
    // On a phone the labels are large against the drawing: a label may run past a state's edge there (its ink outline keeps it
    // readable on the ground), as long as the middle of it is inside. A long leader across the country would read worse.
    const k = compact ? 0.72 : 1;
    const fits = !ALWAYS_CALLOUT.has(entry.abbr) && labelFits(largestPart(f.geometry, project), cx, cy, labelW * k, abbrSize * (compact ? 0.95 : 1.1) + 2, seatsSize * (compact ? 0.85 : 0.95) + 2, compact);
    // A label that fits sits inside its state's link, so it can change color with the state's hover and focus fill.
    const inside = fits
      ? svg(
          'text',
          { x: cx, y: cy, class: 'strv-us__label', 'text-anchor': 'middle', 'aria-hidden': 'true' },
          svg('tspan', { x: cx, dy: compact ? '-0.2em' : '-0.35em', class: 'strv-us__abbr' }, entry.abbr),
          svg('tspan', { x: cx, dy: compact ? '1.05em' : '1.15em', class: 'strv-us__seats' }, String(entry.seats)),
        )
      : null;
    active.append(svg('a', { href, 'aria-label': label, class: 'strv-us__state' }, svg('title', null, label), svg('path', { d }), inside));
    if (!fits) {
      const [ax, ay] = eastEdge(f.geometry, (p) => projection(p)) ?? [cx, cy];
      callouts.push({ y: ay, cx: ax, cy: ay, abbr: entry.abbr, seats: entry.seats });
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
        { href: formatHash(stateRoute(c.abbr)), tabindex: -1, class: 'strv-us__callout-link' },
        svg('rect', { x: colX - 8, y: y - (compact ? 18 : 12), width: compact ? 116 : 78, height: compact ? 36 : 24, class: 'strv-us__hit' }),
        svg('text', { x: colX, y, class: 'strv-us__callout', 'dominant-baseline': 'middle' }, svg('tspan', { class: 'strv-us__abbr-ink' }, c.abbr), svg('tspan', { dx: compact ? 10 : 6, class: 'strv-us__seats-ink' }, String(c.seats))),
      ),
    );
  }

  return svg(
    'svg',
    {
      class: compact ? 'strv-us strv-us--compact' : 'strv-us',
      style: compact ? `--us-abbr:${abbrUnits}px;--us-seats:${seatsUnits}px` : null,
      viewBox: `0 0 ${W} ${H}`,
      role: 'group',
      'aria-label': 'Map of the United States. States with a generated map are links, labeled with their number of House seats.',
    },
    quiet,
    active,
    labels,
  );
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
    el.replaceChildren(buildUsMap(opts, compact));
  };
  draw();
  window.addEventListener('resize', draw);
  return { el, destroy: () => window.removeEventListener('resize', draw) };
}
