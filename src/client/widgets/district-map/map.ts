import { Map as MlMap, Marker, NavigationControl, setWorkerUrl, type GeoJSONSource, type PointLike } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre runs its tile work in a module worker; Vite bundles it and hands back its URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { FeatureCollection, MultiLineString, MultiPolygon, Polygon, Position } from 'geojson';
import {
  tokens,
  config,
  bboxOf,
  labelPoint,
  pointAlongLines,
  partialLines,
  firstClearSpot,
  offsetToClear,
  type Box,
  prefersReducedMotion,
  type LonLat,
  type Plan,
} from '../../shared';
import { piecesAfter, pieceSizes, type StateBundle, type PlanShapes, type EnactedShapes } from '../../entities/plan';

export interface MapViewState {
  plan: Plan;
  /** null: finished map; k: the first k cuts. */
  cut: number | null;
  selected: number | null;
  hovered: number | null;
  enacted: EnactedShapes | null;
  located: LonLat | null;
  animate: boolean;
}

export interface DistrictMapOptions {
  container: HTMLElement;
  bundle: StateBundle;
  outlines: FeatureCollection<Polygon | MultiPolygon, { abbr: string; name: string }>;
  stateName: string;
  onSelect(district: number | null): void;
  onHover(district: number | null): void;
}

export interface DistrictMapView {
  set(state: MapViewState): void;
  destroy(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Where along a cut line its number may sit, as fractions of the line's length, in order of preference. */
const CUT_TAG_SPOTS = [0.5, 0.38, 0.62, 0.27, 0.73, 0.16, 0.84, 0.07, 0.93];

const EMPTY_LINES: MultiLineString = { type: 'MultiLineString', coordinates: [] };
const asFeature = (g: MultiLineString) => ({ type: 'Feature' as const, properties: {}, geometry: g });

setWorkerUrl(workerUrl);

export function mountDistrictMap(opts: DistrictMapOptions): Promise<DistrictMapView> {
  const { bundle, container } = opts;
  const seats = bundle.stats.official.metrics.seats;
  const bbox = bboxOf(bundle.official.features.map((f) => f.geometry))!;
  const coarse = matchMedia('(pointer: coarse)').matches;
  // A narrow or short frame (a phone, upright or on its side) puts the key across the top and wants bigger numbers.
  const narrow = container.clientWidth < 520 || container.clientHeight < 400;
  // Touch and small screens get larger numbers (see styles.css), so each needs a larger box to stay clear of its neighbours.
  const roomy = coarse || narrow;
  // Under 600 px the key sits below the map (see styles.css); the map then needs no room at the top for it.
  const keyBelow = matchMedia('(max-width: 37.5rem) and (min-height: 32.01rem)').matches;
  /** Pixel size of a district number's box, used to keep numbers from overlapping. */
  const LABEL_W = roomy ? 32 : 26;
  const LABEL_H = roomy ? 28 : 22;

  const map = new MlMap({
    container,
    style: {
      version: 8,
      sources: {},
      layers: [{ id: 'ground', type: 'background', paint: { 'background-color': tokens.ground } }],
    },
    bounds: bbox,
    fitBoundsOptions: { padding: narrow ? (keyBelow ? 14 : { top: container.clientWidth < 380 ? 64 : 40, right: 14, bottom: 14, left: 14 }) : { top: 52, right: 32, bottom: 32, left: 32 } },
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    renderWorldCopies: false,
    cooperativeGestures: coarse,
    fadeDuration: 0,
  });
  if (prefersReducedMotion()) {
    // Zoom buttons and keys jump instead of gliding.
    const ease = map.easeTo.bind(map);
    map.easeTo = (o, d) => ease({ ...o, duration: 0 }, d);
    const fly = map.flyTo.bind(map);
    map.flyTo = (o, d) => fly({ ...o, duration: 0 }, d);
  }
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  // Zoom buttons sit where a thumb rests on a touch screen.
  map.addControl(new NavigationControl({ showCompass: false }), coarse ? 'bottom-right' : 'top-right');
  // The canvas is described by the region around it; the list is the full text view.
  map.getCanvas().setAttribute('aria-label', `Map of ${opts.stateName} districts. Arrow keys move the map; plus and minus zoom. To choose a district, use the Districts table.`);

  const labelCache = new Map<Plan, LonLat[]>();
  const labelsFor = (plan: Plan): LonLat[] => {
    let l = labelCache.get(plan);
    if (!l) {
      const shapes = plan === 'official' ? bundle.official : bundle.before;
      l = shapes.features.map((f) => labelPoint(f.geometry));
      labelCache.set(plan, l);
    }
    return l;
  };

  // Larger districts claim their spot first; small ones move aside and get a leader.
  const areaCache = new Map<Plan, number[]>();
  const areasFor = (plan: Plan): number[] => {
    let a = areaCache.get(plan);
    if (!a) {
      a = shapesOf(plan).features.map((f) => {
        const b = bboxOf([f.geometry])!;
        return (b[2] - b[0]) * (b[3] - b[1]);
      });
      areaCache.set(plan, a);
    }
    return a;
  };

  /**
   * Lay out every visible label so none covers another. Cut numbers go first:
   * each slides along its own cut line to the nearest spot clear of the other
   * cut numbers and of the district numbers. Then a district number that would
   * still collide moves to the nearest free spot and is joined to its district
   * by a short leader line and a dot.
   */
  function layoutLabels(): void {
    if (!current || !leaders) return;
    const plan: Plan = current.cut !== null ? 'before' : current.plan;
    const labels = labelsFor(plan);
    const areas = areasFor(plan);
    const frame = { w: container.clientWidth, h: container.clientHeight };
    const size = { w: LABEL_W, h: LABEL_H };
    // Larger districts claim their spot first; small ones move aside.
    const order = districtMarkers.map((_, i) => i).filter((i) => !districtMarkers[i]!.el.hidden).sort((a, b) => areas[b]! - areas[a]!);
    const natural: Box[] = order.map((i) => {
      const pt = map.project(labels[i]! as [number, number]);
      return { x: pt.x, y: pt.y, ...size };
    });

    // Cut numbers: newest first, kept on their line.
    const placed: Box[] = [];
    for (const tag of [...cutTags].reverse()) {
      const tagSize = { w: tag.el.offsetWidth || 24, h: tag.el.offsetHeight || 20 };
      const pts = tag.spots.map((s) => map.project(s as [number, number]));
      let at = firstClearSpot(pts, tagSize, [...placed, ...natural], frame) ?? firstClearSpot(pts, tagSize, placed, frame);
      let nudge = { dx: 0, dy: 0 };
      if (at === null) {
        // A short line with no clear spot on it: the number sits as close to the line as the others allow.
        at = 0;
        nudge = offsetToClear(pts[0]!, tagSize, placed, frame, 0, [12, 20, 28, 36, 48]);
      }
      tag.marker.setLngLat(tag.spots[at]! as [number, number]);
      tag.marker.setOffset([nudge.dx, nudge.dy]);
      placed.push({ x: pts[at]!.x + nudge.dx, y: pts[at]!.y + nudge.dy, ...tagSize });
    }

    // District numbers: stay put when free, else move to the nearest free spot, kept inside the frame.
    const out: string[] = [];
    for (const i of order) {
      const { marker } = districtMarkers[i]!;
      const pt = map.project(labels[i]! as [number, number]);
      const { dx, dy } = offsetToClear(pt, size, placed, frame, 0);
      marker.setOffset([dx, dy]);
      placed.push({ x: pt.x + dx, y: pt.y + dy, ...size });
      if (dx || dy) {
        const len = Math.hypot(dx, dy);
        const ex = pt.x + dx - (dx / len) * 11;
        const ey = pt.y + dy - (dy / len) * 9;
        out.push(`<path d="M${pt.x.toFixed(1)},${pt.y.toFixed(1)}L${ex.toFixed(1)},${ey.toFixed(1)}"/><circle cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="2.5"/>`);
      }
    }
    leaders.innerHTML = out.join('');
  }

  let current: MapViewState | null = null;
  let anim: number | null = null;
  let districtMarkers: { marker: Marker; el: HTMLElement }[] = [];
  let cutTags: { marker: Marker; el: HTMLElement; spots: LonLat[] }[] = [];
  let pin: Marker | null = null;
  let leaders: SVGSVGElement | null = null;
  let resizeObs: ResizeObserver | null = null;

  const shapesOf = (plan: Plan): PlanShapes => (plan === 'official' ? bundle.official : bundle.before);

  function setup(): void {
    map.addSource('context', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: opts.outlines.features.filter((f) => f.properties.abbr !== bundle.abbr) },
    });
    for (const plan of ['official', 'before'] as const) {
      map.addSource(plan, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: shapesOf(plan).features },
        promoteId: 'district',
      });
    }
    map.addSource('borders', { type: 'geojson', data: asFeature(EMPTY_LINES) });
    map.addSource('outline', { type: 'geojson', data: asFeature(bundle.official.outline) });
    map.addSource('enacted', { type: 'geojson', data: asFeature(EMPTY_LINES) });
    map.addSource('cuts-past', { type: 'geojson', data: asFeature(EMPTY_LINES) });
    map.addSource('cut-new', { type: 'geojson', data: asFeature(EMPTY_LINES) });

    map.addLayer({ id: 'context-fill', type: 'fill', source: 'context', paint: { 'fill-color': tokens.quietFill } });
    map.addLayer({ id: 'context-line', type: 'line', source: 'context', paint: { 'line-color': tokens.paper, 'line-width': 1.25 } });
    for (const plan of ['official', 'before'] as const) {
      map.addLayer({
        id: `fill-${plan}`,
        type: 'fill',
        source: plan,
        paint: {
          'fill-color': ['coalesce', ['feature-state', 'fill'], tokens.quietFill],
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'hover'], false], 0.82,
            ['boolean', ['feature-state', 'dim'], false], 0.5,
            1,
          ],
        },
      });
    }
    map.addLayer({
      id: 'borders',
      type: 'line',
      source: 'borders',
      layout: { 'line-join': 'round' },
      paint: { 'line-color': tokens.ink, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.9, 10, 1.6] },
    });
    map.addLayer({
      id: 'outline',
      type: 'line',
      source: 'outline',
      layout: { 'line-join': 'round' },
      paint: { 'line-color': tokens.ink, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.5, 10, 2.5] },
    });
    map.addLayer({
      id: 'enacted',
      type: 'line',
      source: 'enacted',
      layout: { 'line-join': 'round', visibility: 'none' },
      paint: { 'line-color': tokens.ink, 'line-width': 1.5, 'line-dasharray': [2, 1.6], 'line-opacity': 0.85 },
    });
    for (const plan of ['official', 'before'] as const) {
      map.addLayer({
        id: `sel-${plan}`,
        type: 'line',
        source: plan,
        filter: ['==', ['get', 'district'], -1],
        layout: { 'line-join': 'round' },
        paint: { 'line-color': tokens.ink, 'line-width': 3.5 },
      });
    }
    map.addLayer({
      id: 'cuts-past',
      type: 'line',
      source: 'cuts-past',
      paint: { 'line-color': tokens.ink, 'line-width': 1.25, 'line-opacity': 0.75 },
    });
    map.addLayer({
      id: 'cut-new-casing',
      type: 'line',
      source: 'cut-new',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': tokens.ink, 'line-width': 6.5 },
    });
    map.addLayer({
      id: 'cut-new',
      type: 'line',
      source: 'cut-new',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': tokens.signal, 'line-width': 3.5 },
    });

    const fillLayers = ['fill-official', 'fill-before'];
    const pick = (pt: PointLike): number | null => {
      const f = map.queryRenderedFeatures(pt, { layers: fillLayers })[0];
      const d = f?.properties?.district;
      return typeof d === 'number' ? d : null;
    };
    map.on('click', (e) => opts.onSelect(pick(e.point)));
    if (!coarse) {
      map.on('mousemove', (e) => {
        const d = pick(e.point);
        map.getCanvas().style.cursor = d === null ? '' : 'pointer';
        if (d !== current?.hovered) opts.onHover(d);
      });
      map.on('mouseout', () => opts.onHover(null));
    }

    leaders = document.createElementNS(SVG_NS, 'svg');
    leaders.setAttribute('class', 'strv-map-leaders');
    leaders.setAttribute('aria-hidden', 'true');
    map.getCanvasContainer().append(leaders);

    districtMarkers = Array.from({ length: seats }, (_, i) => {
      const el = document.createElement('div');
      el.className = 'strv-map-label';
      el.textContent = String(i + 1);
      el.setAttribute('aria-hidden', 'true');
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        opts.onSelect(i + 1);
      });
      const marker = new Marker({ element: el, anchor: 'center' }).setLngLat(labelsFor('official')[i]! as [number, number]).addTo(map);
      return { marker, el };
    });

    map.on('move', layoutLabels);
    map.on('resize', layoutLabels);
    resizeObs = new ResizeObserver(() => map.resize());
    resizeObs.observe(container);
  }

  function src(id: string): GeoJSONSource {
    return map.getSource(id) as GeoJSONSource;
  }

  function stopAnim(): void {
    if (anim !== null) cancelAnimationFrame(anim);
    anim = null;
  }

  function drawNewCut(lines: Position[][], animate: boolean): void {
    stopAnim();
    const set = (ls: Position[][]): void => {
      void src('cut-new').setData(asFeature({ type: 'MultiLineString', coordinates: ls }));
    };
    if (!animate || prefersReducedMotion() || config.cutDrawMs === 0) {
      set(lines);
      return;
    }
    const t0 = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - t0) / config.cutDrawMs);
      const eased = 1 - Math.pow(2, -10 * t);
      set(partialLines(lines, t >= 1 ? 1 : eased));
      anim = t < 1 ? requestAnimationFrame(tick) : null;
    };
    set([]);
    anim = requestAnimationFrame(tick);
  }

  function apply(next: MapViewState): void {
    const prev = current;
    current = next;
    const cutMode = next.cut !== null;
    const plan: Plan = cutMode ? 'before' : next.plan;
    const other: Plan = plan === 'official' ? 'before' : 'official';
    const shapes = shapesOf(plan);

    map.setLayoutProperty(`fill-${plan}`, 'visibility', 'visible');
    map.setLayoutProperty(`fill-${other}`, 'visibility', 'none');
    map.setLayoutProperty(`sel-${plan}`, 'visibility', 'visible');
    map.setLayoutProperty(`sel-${other}`, 'visibility', 'none');

    const piece = cutMode ? piecesAfter(bundle.cuts, next.cut!, seats) : null;
    const sizes = piece ? pieceSizes(piece) : null;

    // Fills: every district its own color, or the color of the piece it is in.
    for (let i = 0; i < seats; i++) {
      const color = bundle.colors[piece ? piece[i]! : i]!;
      const id = i + 1;
      map.setFeatureState({ source: plan, id }, {
        fill: color,
        hover: next.hovered === id && next.hovered !== next.selected,
        dim: next.selected !== null && next.selected !== id,
      });
    }

    const bordersChanged = !prev || prev.cut !== next.cut || (prev.cut === null && prev.plan !== next.plan);
    if (bordersChanged) src('borders').setData(asFeature(piece ? shapes.pieceBorders(piece) : shapes.borders));

    map.setFilter(`sel-${plan}`, ['==', ['get', 'district'], next.selected ?? -1]);

    // District numbers: shown once a district is its own piece.
    const labels = labelsFor(plan);
    districtMarkers.forEach(({ marker, el }, i) => {
      marker.setLngLat(labels[i]! as [number, number]);
      const visible = !piece || sizes!.get(piece[i]!) === 1;
      el.hidden = !visible;
      el.dataset.selected = String(next.selected === i + 1);
    });

    // Cut lines and their numbers.
    if (!prev || prev.cut !== next.cut) {
      for (const t of cutTags) t.marker.remove();
      cutTags = [];
      if (cutMode && next.cut! > 0) {
        const done = bundle.cuts.slice(0, next.cut!);
        const newest = done[done.length - 1]!;
        src('cuts-past').setData(
          asFeature({ type: 'MultiLineString', coordinates: done.slice(0, -1).flatMap((c) => c.lines as Position[][]) }),
        );
        drawNewCut(newest.lines as Position[][], next.animate && prev !== null && prev.cut !== null && next.cut === prev.cut + 1);
        done.forEach((c, i) => {
          // Spots along the cut line, best first: the middle, then alternating either side.
          const spots = CUT_TAG_SPOTS.map((f) => pointAlongLines(c.lines as Position[][], f)).filter((p): p is LonLat => p !== null);
          if (!spots[0]) return;
          const el = document.createElement('div');
          el.className = 'strv-cut-tag';
          el.dataset.newest = String(i === done.length - 1);
          el.textContent = String(c.order);
          el.setAttribute('aria-hidden', 'true');
          cutTags.push({ marker: new Marker({ element: el, anchor: 'center' }).setLngLat(spots[0] as [number, number]).addTo(map), el, spots });
        });
      } else {
        stopAnim();
        src('cuts-past').setData(asFeature(EMPTY_LINES));
        src('cut-new').setData(asFeature(EMPTY_LINES));
      }
    }

    layoutLabels();

    // Today's districts, display only.
    if (next.enacted) {
      if (prev?.enacted !== next.enacted) src('enacted').setData(asFeature(next.enacted.lines));
      map.setLayoutProperty('enacted', 'visibility', 'visible');
    } else {
      map.setLayoutProperty('enacted', 'visibility', 'none');
    }

    // The visitor's address, when one was found in this state.
    if (next.located) {
      if (!pin) {
        const el = document.createElement('div');
        el.className = 'strv-pin';
        el.setAttribute('aria-hidden', 'true');
        pin = new Marker({ element: el, anchor: 'center' });
      }
      pin!.setLngLat(next.located as [number, number]).addTo(map);
      if (!prev || prev.located !== next.located) {
        map.easeTo({ center: next.located as [number, number], zoom: Math.max(map.getZoom(), 8), duration: prefersReducedMotion() ? 0 : 600 });
      }
    } else if (pin) {
      pin.remove();
    }
  }

  return new Promise((resolve) => {
    let pending: MapViewState | null = null;
    let ready = false;
    map.on('load', () => {
      setup();
      ready = true;
      if (pending) apply(pending);
    });
    resolve({
      set(state) {
        if (ready) apply(state);
        else pending = state;
      },
      destroy() {
        stopAnim();
        resizeObs?.disconnect();
        map.remove();
      },
    });
  });
}
