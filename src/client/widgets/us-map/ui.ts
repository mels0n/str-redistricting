import { geoAlbersUsa, geoPath } from 'd3-geo';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { svg, formatHash, stateRoute } from '../../shared';
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

/**
 * The national index map: every state in outline, states with a generated
 * map set in ink with their number of seats. Small states get a label in a
 * column to the east, joined by a hairline.
 */
export function createUsMap(opts: UsMapOptions): SVGSVGElement {
  const projection = geoAlbersUsa().fitExtent(
    [
      [8, 8],
      [W - 96, H - 8],
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
    const [[x0, y0], [x1, y1]] = path.bounds(f);
    const [cx, cy] = path.centroid(f);
    const href = formatHash(stateRoute(entry.abbr));
    const label = `${entry.name}, ${entry.seats} districts`;
    active.append(svg('a', { href, 'aria-label': label, class: 'strv-us__state' }, svg('title', null, label), svg('path', { d })));
    const fits = x1 - x0 > 54 && y1 - y0 > 40 && !ALWAYS_CALLOUT.has(entry.abbr);
    if (fits) {
      labels.append(
        svg(
          'text',
          { x: cx, y: cy, class: 'strv-us__label', 'text-anchor': 'middle' },
          svg('tspan', { x: cx, dy: '-0.35em', class: 'strv-us__abbr' }, entry.abbr),
          svg('tspan', { x: cx, dy: '1.15em', class: 'strv-us__seats' }, String(entry.seats)),
        ),
      );
    } else {
      const [ax, ay] = eastEdge(f.geometry, (p) => projection(p)) ?? [cx, cy];
      callouts.push({ y: ay, cx: ax, cy: ay, abbr: entry.abbr, seats: entry.seats });
    }
  }

  // Stack the callouts in a column on the east edge, keeping their order north to south.
  callouts.sort((a, b) => a.y - b.y);
  const colX = W - 78;
  let lastY = -Infinity;
  for (const c of callouts) {
    const y = Math.max(c.y, lastY + 26);
    lastY = y;
    labels.append(
      svg('path', { d: `M${c.cx},${c.cy}L${colX - 30},${y}H${colX - 6}`, class: 'strv-us__leader' }),
      svg('circle', { cx: c.cx, cy: c.cy, r: 2.5, class: 'strv-us__dot' }),
      // A larger click target for small states; the state shape itself is the keyboard stop.
      svg(
        'a',
        { href: formatHash(stateRoute(c.abbr)), tabindex: -1, class: 'strv-us__callout-link' },
        svg('rect', { x: colX - 8, y: y - 12, width: 78, height: 24, class: 'strv-us__hit' }),
        svg('text', { x: colX, y, class: 'strv-us__callout', 'dominant-baseline': 'middle' }, svg('tspan', { class: 'strv-us__abbr-ink' }, c.abbr), svg('tspan', { dx: 6, class: 'strv-us__seats-ink' }, String(c.seats))),
      ),
    );
  }

  return svg(
    'svg',
    {
      class: 'strv-us',
      viewBox: `0 0 ${W} ${H}`,
      role: 'group',
      'aria-label': 'Map of the United States. States with a generated map are links, labeled with their number of House seats.',
    },
    quiet,
    active,
    labels,
  );
}
