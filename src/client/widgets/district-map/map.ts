import { Map as MlMap, Marker, NavigationControl, setWorkerUrl, type GeoJSONSource, type PointLike } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre runs its tile work in a module worker; Vite bundles it and hands back its URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { FeatureCollection, MultiLineString, MultiPolygon, Polygon, Position } from 'geojson';
import {
  tokens,
  config,
  bboxOf,
  openingBox,
  crossesAntimeridian,
  labelPoint,
  landLabelPoint,
  WATER_VEIL,
  pointAlongLines,
  partialLines,
  firstClearSpot,
  offsetToClear,
  clusterPoints,
  boxesOverlap,
  cutTagPlan,
  fitPadding,
  makeShape,
  NumberPlacer,
  type Box,
  type NumberItem,
  type MarkerSpot,
  type Pt,
  type Shape,
  prefersReducedMotion,
  pageZoomed,
  watchPageZoom,
  type LonLat,
  type Plan,
} from '../../shared';
import {
  DETAIL_SOURCE,
  FILL_OPACITY,
  BORDER_WIDTH,
  OUTLINE_WIDTH,
  detailLayerSpecs,
  detailSource,
  fadedPaint,
  registerPmtiles,
  setDistrictState,
  dropDetail,
  shouldDropDetail,
  twinVisibility,
  bordersFilter,
  selectedFilter,
} from './detail';
import { piecesAfter, pieceSizes, movedBlocksAt, balancePlanAt, type StateBundle, type PlanShapes, type EnactedShapes, type BalanceLog } from '../../entities/plan';

export interface MapViewState {
  plan: Plan;
  /** null: finished map; k: the first k cuts. */
  cut: number | null;
  /** null outside the balancing replay; m: the plan after the first m balancing moves. */
  move: number | null;
  /** The balancing log, once loaded; needed to draw the moved blocks. */
  balance: BalanceLog | null;
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
  /** Zooms to the block the current balancing move took across a border. */
  zoomToMove(): void;
  destroy(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Where along a cut line its number may sit, as fractions of the line's length, in order of preference. */
const CUT_TAG_SPOTS = [0.5, 0.38, 0.62, 0.27, 0.73, 0.16, 0.84, 0.07, 0.93];

const EMPTY_LINES: MultiLineString = { type: 'MultiLineString', coordinates: [] };

/**
 * The plan drawn underneath: the cut sequence and the balancing replay start from the plan before balancing,
 * and the replay's last move is the finished map, so the old borders stop showing through the moved blocks.
 */
const planOnScreen = (s: MapViewState, moves: number): Plan => {
  if (s.move !== null) return balancePlanAt(s.move, moves);
  return s.cut !== null ? 'before' : s.plan;
};
const asFeature = (g: MultiLineString) => ({ type: 'Feature' as const, properties: {}, geometry: g });

setWorkerUrl(workerUrl);

export function mountDistrictMap(opts: DistrictMapOptions): Promise<DistrictMapView> {
  const { bundle, container } = opts;
  const seats = bundle.stats.finished.metrics.seats;
  const balanceMoves = bundle.stats.finished.metrics.balanceMoves;
  const planShown = (s: MapViewState): Plan => planOnScreen(s, balanceMoves);
  const bbox = openingBox(bundle.abbr, bboxOf(bundle.finished.features.map((f) => f.geometry))!);
  const coarse = matchMedia('(pointer: coarse)').matches;
  // Under 600 px the key sits below the map (see styles.css); the map then needs no room at the top for it.
  const keyBelow = matchMedia('(max-width: 37.5rem) and (min-height: 32.01rem)').matches;
  // Touch and small screens get larger numbers (see styles.css); the box used for placement matches them.
  const big = matchMedia('(pointer: coarse), (max-width: 40rem)').matches;
  /** Pixel size of a district number's box. */
  const LABEL_W = big ? 30 : 26;
  const LABEL_H = big ? 28 : 24;

  /** Room around the state inside the frame: the key at the top (unless it is below the map) and the zoom buttons at their side. */
  function framePadding(): { top: number; right: number; bottom: number; left: number } {
    return fitPadding({ frameW: container.clientWidth, frameH: container.clientHeight, keyBelow, key: keyBox(), controls: controlsBox() });
  }
  /** Enlarged text makes numbers, chips and the key bigger; the boxes used for placement grow with it. */
  const textScale = (): number => Math.max(1, (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16) / 16);
  /** The key's box in the map's own coordinates (centre and size), when it lies over the map. */
  function keyBox(): Box | null {
    const key = container.parentElement?.querySelector('.strv-legend');
    if (!key) return null;
    const k = key.getBoundingClientRect();
    const f = container.getBoundingClientRect();
    if (k.width === 0 || k.height === 0 || k.bottom > f.bottom - 1 || k.top < f.top - 1) return null;
    const g = 6;
    return { x: k.left - f.left + k.width / 2, y: k.top - f.top + k.height / 2, w: k.width + 2 * g, h: k.height + 2 * g };
  }
  /** The zoom buttons' box in the map's own coordinates. */
  function controlsBox(): Box | null {
    const ctrl = container.querySelector('.maplibregl-ctrl-group');
    if (!ctrl) return null;
    const c = ctrl.getBoundingClientRect();
    const f = container.getBoundingClientRect();
    if (c.width === 0 || c.height === 0) return null;
    return { x: c.left - f.left + c.width / 2, y: c.top - f.top + c.height / 2, w: c.width, h: c.height };
  }
  let fittedPad = '';
  /** True once the visitor has panned or zoomed; until then the whole state stays fitted to the frame as it changes size. */
  let userMoved = false;

  const map = new MlMap({
    container,
    style: {
      version: 8,
      sources: {},
      layers: [{ id: 'ground', type: 'background', paint: { 'background-color': tokens.ground } }],
    },
    bounds: bbox,
    fitBoundsOptions: { padding: framePadding() },
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    // Alaska is drawn past -180 (the Aleutians), which a single world copy would clip off.
    renderWorldCopies: crossesAntimeridian(bundle.abbr),
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
  fittedPad = JSON.stringify(framePadding());
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  // While the page itself is pinch-zoomed, finger gestures go to the page, not the map, so the visitor
  // can always pinch back out (the map could otherwise fill the screen and take every pinch).
  // The zoom buttons and keys still move the map.
  const setTouchToPage = (toPage: boolean): void => {
    if (toPage) {
      map.touchZoomRotate.disable();
      map.dragPan.disable();
    } else {
      map.touchZoomRotate.enable();
      // enable() turns two-finger rotation back on as well; the map never rotates.
      map.touchZoomRotate.disableRotation();
      map.dragPan.enable();
    }
  };
  const stopWatchingZoom = coarse ? watchPageZoom(setTouchToPage) : () => {};
  if (coarse && pageZoomed()) setTouchToPage(true);
  // Zoom buttons sit where a thumb rests on a touch screen.
  map.addControl(new NavigationControl({ showCompass: false }), coarse ? 'bottom-right' : 'top-right');
  // The canvas is described by the region around it; the list is the full text view.
  map.getCanvas().setAttribute('aria-label', `Map of ${opts.stateName} districts. Arrow keys move the map; plus and minus zoom. To choose a district, use the Districts table.`);

  /** The water mask's polygons: district numbers prefer the land part of a district. */
  const waterPolys: Position[][][] = (bundle.water?.features ?? []).flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates));
  const labelCache = new Map<Plan, LonLat[]>();
  const labelsFor = (plan: Plan): LonLat[] => {
    let l = labelCache.get(plan);
    if (!l) {
      const shapes = plan === 'finished' ? bundle.finished : bundle.before;
      l = shapes.features.map((f) => (waterPolys.length > 0 ? landLabelPoint(f.geometry, waterPolys) : labelPoint(f.geometry)));
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

  /** A district's outline in pixels at the current view. Points closer than 1.5 px to the last kept one are dropped. */
  function pixelShape(geom: Polygon | MultiPolygon): Shape {
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    return makeShape(
      polys.map((poly) =>
        poly.map((ring) => {
          const out: Pt[] = [];
          for (const c of ring) {
            const q = map.project(c as [number, number]);
            const last = out[out.length - 1];
            if (!last || Math.hypot(q.x - last.x, q.y - last.y) >= 1.5) out.push({ x: q.x, y: q.y });
          }
          return out;
        }),
      ),
    );
  }

  /** Leader lines (screen space follows the map as it moves, so they are redrawn from map positions). */
  let leaderPairs: { anchor: LonLat; at: LonLat }[] = [];
  function drawLeaders(): void {
    if (!leaders) return;
    const out: string[] = [];
    for (const { anchor, at } of leaderPairs) {
      const a = map.project(anchor as [number, number]);
      const b = map.project(at as [number, number]);
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 14) continue;
      const ex = b.x - ((b.x - a.x) / len) * 11;
      const ey = b.y - ((b.y - a.y) / len) * 11;
      out.push(`<path d="M${a.x.toFixed(1)},${a.y.toFixed(1)}L${ex.toFixed(1)},${ey.toFixed(1)}"/><circle cx="${a.x.toFixed(1)}" cy="${a.y.toFixed(1)}" r="2.5"/>`);
    }
    leaders.innerHTML = out.join('');
  }

  /**
   * Lay out every visible label. Cut numbers go first: each slides along its own
   * cut line to the nearest spot clear of the other cut numbers and of the
   * district numbers. Then each district number goes inside its own district,
   * or, failing that, in empty ground outside the state a short leader away;
   * it is never placed inside another district's color. Numbers that cannot be
   * placed that way give way to one "+N" marker per crowd, which sits in one of
   * those districts or outside the state and zooms in when pressed. Every
   * district stays in the Districts list.
   */
  function layoutLabels(): void {
    if (!current || !leaders) return;
    const plan = planShown(current);
    const labels = labelsFor(plan);
    const areas = areasFor(plan);
    const frame = { w: container.clientWidth, h: container.clientHeight };
    const scale = textScale();
    const size = { w: Math.round(LABEL_W * scale), h: Math.round(LABEL_H * scale) };
    // Larger districts claim their spot first.
    const order = districtMarkers.map((_, i) => i).filter((i) => !districtMarkers[i]!.el.hidden).sort((a, b) => areas[b]! - areas[a]!);
    const pts = labels.map((l) => {
      const q = map.project(l as [number, number]);
      return { x: q.x, y: q.y };
    });
    const natural: Box[] = order.map((i) => ({ x: pts[i]!.x, y: pts[i]!.y, ...size }));

    // The zoom buttons are part of the frame too; nothing is placed under them.
    const placed: Box[] = [];
    const ctrl = container.querySelector('.maplibregl-ctrl-group');
    if (ctrl) {
      const c = ctrl.getBoundingClientRect();
      const f = container.getBoundingClientRect();
      placed.push({ x: c.left - f.left + c.width / 2, y: c.top - f.top + c.height / 2, w: c.width + 4, h: c.height + 4 });
    }
    // The key lies over the map; nothing is placed under it.
    const keyObstacle = keyBox();
    if (keyObstacle) placed.push(keyObstacle);
    // Cut numbers: the newest goes first and is never displaced (it takes the best spot on its line that is in view);
    // the others keep clear of it and of each other where their lines allow, and may overlap when they cannot.
    const newestFirst = [...cutTags].reverse();
    let newestBox: Box | null = null;
    for (const [n, tag] of newestFirst.entries()) {
      const tagSize = { w: tag.el.offsetWidth || 24 * scale, h: tag.el.offsetHeight || 20 * scale };
      const spots = tag.spots.map((s) => map.project(s as [number, number]));
      if (n === 0) {
        // In view and clear of the zoom buttons when its line allows; otherwise just in view.
        const at0 = firstClearSpot(spots, tagSize, placed, frame) ?? firstClearSpot(spots, tagSize, [], frame) ?? 0;
        tag.marker.setLngLat(tag.spots[at0]! as [number, number]);
        tag.marker.setOffset([0, 0]);
        newestBox = { x: spots[at0]!.x, y: spots[at0]!.y, ...tagSize };
        placed.push(newestBox);
        continue;
      }
      let at = firstClearSpot(spots, tagSize, [...placed, ...natural], frame) ?? firstClearSpot(spots, tagSize, placed, frame);
      let nudge = { dx: 0, dy: 0 };
      if (at === null) {
        // A short line with no clear spot on it: the number sits as close to the line as the others allow.
        // Failing that, at least never on the newest number.
        at = (newestBox ? firstClearSpot(spots, tagSize, [newestBox], frame) : null) ?? 0;
        nudge = offsetToClear(spots[at]!, tagSize, placed, frame, 2, [12, 20, 28, 36, 48]);
        const moved = { x: spots[at]!.x + nudge.dx, y: spots[at]!.y + nudge.dy, ...tagSize };
        if (newestBox && boxesOverlap(moved, newestBox, 2)) nudge = offsetToClear(spots[at]!, tagSize, [newestBox], frame, 2, [12, 20, 28, 36, 48, 64, 80]);
      }
      tag.marker.setLngLat(tag.spots[at]! as [number, number]);
      tag.marker.setOffset([nudge.dx, nudge.dy]);
      placed.push({ x: spots[at]!.x + nudge.dx, y: spots[at]!.y + nudge.dy, ...tagSize });
    }

    const shapes = shapesOf(plan).features.map((f) => pixelShape(f.geometry));
    const placer = new NumberPlacer(shapes, placed, frame, 2, waterPolys.map((p) => pixelShape({ type: 'Polygon', coordinates: p })));
    const items: NumberItem[] = shapes.map((shape, i) => ({ anchor: pts[i]!, size, shape }));
    leaderPairs = [];
    const unplaced: number[] = [];
    districtMarkers.forEach(({ el }) => {
      el.dataset.crowded = 'false';
    });
    for (const i of order) {
      const spot = placer.placeNumber(items[i]!);
      if (!spot) {
        districtMarkers[i]!.el.dataset.crowded = 'true';
        unplaced.push(i);
        continue;
      }
      const at = map.unproject([spot.x, spot.y]);
      districtMarkers[i]!.marker.setLngLat([at.lng, at.lat]).setOffset([0, 0]);
      if (spot.kind === 'outside') leaderPairs.push({ anchor: labels[i]!, at: [at.lng, at.lat] });
    }

    // Crowd markers, one per cluster of numbers that did not fit.
    const inFrame = unplaced.filter((i) => pts[i]!.x >= 0 && pts[i]!.y >= 0 && pts[i]!.x <= frame.w && pts[i]!.y <= frame.h);
    const groups = clusterPoints(inFrame.map((i) => pts[i]!), 44, 90).map((g) => g.map((k) => inFrame[k]!));
    const chipSize = { w: Math.round(44 * scale), h: Math.round(28 * scale) };
    chipTargets = [];
    const centroidOf = (g: number[]): Pt => ({ x: g.reduce((t, i) => t + pts[i]!.x, 0) / g.length, y: g.reduce((t, i) => t + pts[i]!.y, 0) / g.length });
    const crowds: { members: number[]; spot: MarkerSpot }[] = [];
    const failed: number[][] = [];
    for (const g of groups) {
      const ms = g.map((i) => items[i]!);
      const centroid = centroidOf(g);
      // Each cluster gets its own marker; a farther spot is tried before giving up on one.
      const spot = [160, 220, 300, 400].reduce<MarkerSpot | null>((found, reach) => found ?? placer.placeMarker(chipSize, ms, centroid, reach), null);
      if (spot) crowds.push({ members: g, spot });
      else failed.push(g);
    }
    // Only a crowd that found no room anywhere joins the nearest marker, so no district is left without a way to zoom to it.
    for (const g of failed) {
      const c = centroidOf(g);
      const near = [...crowds].sort((x, y) => Math.hypot(centroidOf(x.members).x - c.x, centroidOf(x.members).y - c.y) - Math.hypot(centroidOf(y.members).x - c.x, centroidOf(y.members).y - c.y))[0];
      if (near) near.members.push(...g);
    }
    let used = 0;
    for (const { members, spot } of crowds) {
      const chip = chipAt(used);
      const at = map.unproject([spot.x, spot.y]);
      chip.el.textContent = `+${members.length}`;
      chip.el.setAttribute('aria-label', `${members.length} more ${members.length === 1 ? 'district' : 'districts'} here, zoom in`);
      chip.marker.setLngLat([at.lng, at.lat]);
      if (!chip.on) chip.marker.addTo(map);
      chip.on = true;
      chipTargets[used] = members;
      if (spot.kind === 'outside') {
        const from = map.unproject([spot.anchor.x, spot.anchor.y]);
        leaderPairs.push({ anchor: [from.lng, from.lat], at: [at.lng, at.lat] });
      }
      used++;
    }
    for (let n = used; n < chips.length; n++) {
      if (chips[n]!.on) chips[n]!.marker.remove();
      chips[n]!.on = false;
    }
    drawLeaders();
  }

  let current: MapViewState | null = null;
  let anim: number | null = null;
  let districtMarkers: { marker: Marker; el: HTMLElement }[] = [];
  // "+N" markers standing in for numbers that do not fit; one is reused per crowd.
  const chips: { marker: Marker; el: HTMLElement; on: boolean }[] = [];
  let chipTargets: number[][] = [];
  function chipAt(n: number): { marker: Marker; el: HTMLElement; on: boolean } {
    let c = chips[n];
    if (!c) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'strv-map-cluster';
      el.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const g = chipTargets[n];
        if (!g || !current) return;
        const labels = labelsFor(planShown(current));
        const lls = g.map((i) => labels[i]!);
        const lons = lls.map((l) => l[0]);
        const lats = lls.map((l) => l[1]);
        userMoved = true;
        map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 70, maxZoom: Math.min(11, map.getZoom() + 3.5) });
        // The marker is about to go away; a keyboard visitor lands on the map so arrow keys keep working.
        if (ev.detail === 0) map.getCanvas().focus({ preventScroll: true });
      });
      c = { marker: new Marker({ element: el, anchor: 'center' }), el, on: false };
      chips[n] = c;
    }
    return c;
  }
  let cutTags: { marker: Marker; el: HTMLElement; spots: LonLat[] }[] = [];
  let pin: Marker | null = null;
  /** The ring that marks the block of the current balancing move, which is too small to see at state scale. */
  let moveMark: Marker | null = null;
  /** The log whose blocks are in the 'moved' source. */
  let drawnLog: BalanceLog | null = null;
  /** Bounds of the current move's block, for "zoom to block". */
  let moveBounds: [number, number, number, number] | null = null;
  let leaders: SVGSVGElement | null = null;
  let resizeObs: ResizeObserver | null = null;

  const shapesOf = (plan: Plan): PlanShapes => (plan === 'finished' ? bundle.finished : bundle.before);

  /** Set once the detail tiles have failed to load; the detail layers stay hidden after that. */
  let detailFailed = false;

  /** Adds the detail layers that belong directly above `id`. */
  function addDetailAfter(id: string): void {
    for (const s of detailLayerSpecs()) if (s.after === id) map.addLayer(s.layer);
  }

  function setup(): void {
    map.addSource('context', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: opts.outlines.features.filter((f) => f.properties.abbr !== bundle.abbr) },
    });
    for (const plan of ['finished', 'before'] as const) {
      map.addSource(plan, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: shapesOf(plan).features },
        promoteId: 'district',
      });
    }
    registerPmtiles();
    map.addSource(DETAIL_SOURCE, detailSource(bundle.abbr));
    map.addSource('water', { type: 'geojson', data: bundle.water ?? { type: 'FeatureCollection', features: [] } });
    map.addSource('borders', { type: 'geojson', data: asFeature(EMPTY_LINES) });
    map.addSource('outline', { type: 'geojson', data: asFeature(bundle.finished.outline) });
    map.addSource('enacted', { type: 'geojson', data: asFeature(EMPTY_LINES) });
    map.addSource('cuts-past', { type: 'geojson', data: asFeature(EMPTY_LINES) });
    map.addSource('cut-new', { type: 'geojson', data: asFeature(EMPTY_LINES) });
    map.addSource('moved', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

    map.addLayer({ id: 'context-fill', type: 'fill', source: 'context', paint: { 'fill-color': tokens.quietFill } });
    map.addLayer({ id: 'context-line', type: 'line', source: 'context', paint: { 'line-color': tokens.paper, 'line-width': 1.25 } });
    for (const plan of ['finished', 'before'] as const) {
      map.addLayer({
        id: `fill-${plan}`,
        type: 'fill',
        source: plan,
        paint: {
          'fill-color': ['coalesce', ['feature-state', 'fill'], tokens.quietFill],
          'fill-opacity': FILL_OPACITY,
        },
      });
      addDetailAfter(`fill-${plan}`);
    }
    // Blocks the balancing has moved so far, in the color of the district they joined.
    map.addLayer({
      id: 'moved-fill',
      type: 'fill',
      source: 'moved',
      layout: { visibility: 'none' },
      paint: {
        'fill-color': ['coalesce', ['feature-state', 'fill'], tokens.quietFill],
        'fill-opacity': [
          'case',
          ['!', ['boolean', ['feature-state', 'on'], false]], 0,
          ['boolean', ['feature-state', 'dim'], false], 0.5,
          1,
        ],
      },
    });
    map.addLayer({
      id: 'borders',
      type: 'line',
      source: 'borders',
      layout: { 'line-join': 'round' },
      paint: { 'line-color': tokens.ink, 'line-width': BORDER_WIDTH },
    });
    addDetailAfter('borders');
    map.addLayer({
      id: 'outline',
      type: 'line',
      source: 'outline',
      layout: { 'line-join': 'round' },
      paint: { 'line-color': tokens.ink, 'line-width': OUTLINE_WIDTH },
    });
    addDetailAfter('outline');
    // Water inside the districts (lakes, bays, coastal water) is washed with the ground color: the district's color stays faintly
    // visible, land leads, and the borders that run across water are softened with it. Display only: nothing queries this layer.
    map.addLayer({ id: 'water-veil', type: 'fill', source: 'water', paint: { 'fill-color': tokens.ground, 'fill-opacity': WATER_VEIL } });
    addDetailAfter('water-veil');
    map.addLayer({
      id: 'enacted',
      type: 'line',
      source: 'enacted',
      layout: { 'line-join': 'round', visibility: 'none' },
      paint: { 'line-color': tokens.ink, 'line-width': 1.5, 'line-dasharray': [2, 1.6], 'line-opacity': 0.85 },
    });
    for (const plan of ['finished', 'before'] as const) {
      map.addLayer({
        id: `sel-${plan}`,
        type: 'line',
        source: plan,
        filter: ['==', ['get', 'district'], -1],
        layout: { 'line-join': 'round' },
        paint: { 'line-color': tokens.ink, 'line-width': 3.5 },
      });
      addDetailAfter(`sel-${plan}`);
    }
    // The simplified layers fade out as the detail tiles fade in; if the tiles cannot be had, the map is as it was.
    for (const p of fadedPaint()) map.setPaintProperty(p.id, p.prop, p.faded);
    map.on('error', (e) => {
      if (!shouldDropDetail(e, detailFailed)) return;
      detailFailed = true;
      dropDetail(map);
    });
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
    // The block the current balancing move took across: amber over an ink casing, above everything else.
    map.addLayer({
      id: 'move-now-casing',
      type: 'line',
      source: 'moved',
      filter: ['==', ['id'], -1],
      layout: { 'line-join': 'round', visibility: 'none' },
      paint: { 'line-color': tokens.ink, 'line-width': 5 },
    });
    map.addLayer({
      id: 'move-now',
      type: 'line',
      source: 'moved',
      filter: ['==', ['id'], -1],
      layout: { 'line-join': 'round', visibility: 'none' },
      paint: { 'line-color': tokens.signal, 'line-width': 2.5 },
    });

    const fillLayers = ['fill-finished', 'fill-before', 'fill-finished-detail', 'fill-before-detail'];
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
      const marker = new Marker({ element: el, anchor: 'center' }).setLngLat(labelsFor('finished')[i]! as [number, number]).addTo(map);
      return { marker, el };
    });

    map.on('move', drawLeaders);
    map.on('moveend', layoutLabels);
    map.on('resize', () => {
      // Whatever changed the frame's size (the panel under the map, the window), the whole state stays in view until the visitor moves the map.
      if (!userMoved) map.fitBounds(bbox, { padding: framePadding(), duration: 0 });
      layoutLabels();
    });
    map.on('movestart', (e) => {
      if ((e as { originalEvent?: unknown }).originalEvent) userMoved = true;
    });
    // The frame changes height when the sequence opens or its readout fills in; keep the whole state in view.
    resizeObs = new ResizeObserver(() => {
      map.resize();
      if (!userMoved) map.fitBounds(bbox, { padding: framePadding(), duration: 0 });
    });
    resizeObs.observe(container);
    // The key grows and shrinks (it folds away in a short frame); the state keeps clear of it.
    const keyEl = container.parentElement?.querySelector('.strv-legend');
    if (keyEl) resizeObs.observe(keyEl);
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

  /** Draws the balancing replay at move m: every block moved so far in its new district's color, the latest one marked. */
  function drawBalance(next: MapViewState): void {
    const log = next.move !== null ? next.balance : null;
    const vis = log ? 'visible' : 'none';
    for (const id of ['moved-fill', 'move-now-casing', 'move-now']) map.setLayoutProperty(id, 'visibility', vis);
    if (!log) {
      moveMark?.remove();
      moveBounds = null;
      return;
    }
    if (drawnLog !== log) {
      drawnLog = log;
      src('moved').setData({
        type: 'FeatureCollection',
        features: log.blocks.map((b) => ({ type: 'Feature' as const, id: b.id, properties: {}, geometry: b.geometry })),
      });
    }
    const m = next.move!;
    const at = movedBlocksAt(log.moves, m);
    for (const b of log.blocks) {
      const d = at.get(b.geoid);
      map.setFeatureState(
        { source: 'moved', id: b.id },
        { on: d !== undefined, fill: d !== undefined ? bundle.colors[d - 1]! : tokens.quietFill, dim: d !== undefined && next.selected !== null && next.selected !== d },
      );
    }
    const move = m >= 1 ? log.moves[m - 1] : undefined;
    const block = move ? log.blockByGeoid.get(move.geoid) : undefined;
    const filter: ['==', ['id'], number] = ['==', ['id'], block ? block.id : -1];
    map.setFilter('move-now-casing', filter);
    map.setFilter('move-now', filter);
    moveBounds = block ? block.bbox : null;
    if (!block) {
      moveMark?.remove();
      return;
    }
    if (!moveMark) {
      const el = document.createElement('div');
      el.className = 'strv-move-mark';
      el.setAttribute('aria-hidden', 'true');
      moveMark = new Marker({ element: el, anchor: 'center' });
    }
    moveMark.setLngLat(block.label as [number, number]).addTo(map);
  }

  function apply(next: MapViewState): void {
    const prev = current;
    current = next;
    // A replay opening changes the frame a lot (the controls come up under the map): show the whole state again, even if it was zoomed.
    const replayOpened = prev !== null && ((prev.cut === null && next.cut !== null) || (prev.move === null && next.move !== null));
    if (replayOpened) userMoved = false;
    // The key may have grown or changed since the last fit (it is filled after the map is made).
    const pad = JSON.stringify(framePadding());
    if (!userMoved && fittedPad !== '' && (replayOpened || pad !== fittedPad)) map.fitBounds(bbox, { padding: framePadding(), duration: 0 });
    fittedPad = pad;
    const cutMode = next.cut !== null;
    const plan = planShown(next);
    const other: Plan = plan === 'finished' ? 'before' : 'finished';
    const shapes = shapesOf(plan);

    map.setLayoutProperty(`fill-${plan}`, 'visibility', 'visible');
    map.setLayoutProperty(`fill-${other}`, 'visibility', 'none');
    map.setLayoutProperty(`sel-${plan}`, 'visibility', 'visible');
    map.setLayoutProperty(`sel-${other}`, 'visibility', 'none');
    for (const kind of ['fill', 'sel', 'borders', 'outline']) {
      map.setLayoutProperty(`${kind}-${plan}-detail`, 'visibility', twinVisibility(plan, plan, detailFailed));
      map.setLayoutProperty(`${kind}-${other}-detail`, 'visibility', twinVisibility(plan, other, detailFailed));
    }

    const piece = cutMode ? piecesAfter(bundle.cuts, next.cut!, seats) : null;
    const sizes = piece ? pieceSizes(piece) : null;

    // Fills: every district its own color, or the color of the piece it is in.
    for (let i = 0; i < seats; i++) {
      const color = bundle.colors[piece ? piece[i]! : i]!;
      const id = i + 1;
      setDistrictState(map, plan, id, {
        fill: color,
        hover: next.hovered === id && next.hovered !== next.selected,
        // In the cut sequence the colors are pieces, not districts, so a chosen district does not wash out the rest.
        dim: !cutMode && next.selected !== null && next.selected !== id,
      });
    }

    const bordersChanged = !prev || prev.cut !== next.cut || planShown(prev) !== plan;
    if (bordersChanged) src('borders').setData(asFeature(piece ? shapes.pieceBorders(piece) : shapes.borders));

    map.setFilter(`sel-${plan}`, ['==', ['get', 'district'], next.selected ?? -1]);
    map.setFilter(`sel-${plan}-detail`, selectedFilter(next.selected));
    if (bordersChanged) map.setFilter(`borders-${plan}-detail`, bordersFilter(piece));

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
        // The newest cut always carries its number ("Cut 8"); a small frame or a long sequence labels fewer of the earlier ones.
        const compact = container.clientWidth < 520 || container.clientHeight < 400;
        const plan = cutTagPlan(done.map((c) => c.order), { compact });
        done.forEach((c) => {
          const tagPlan = plan.find((t) => t.order === c.order);
          if (!tagPlan) return;
          // Spots along the cut line, best first: the middle, then alternating either side.
          const spots = CUT_TAG_SPOTS.map((f) => pointAlongLines(c.lines as Position[][], f)).filter((p): p is LonLat => p !== null);
          if (!spots[0]) return;
          const el = document.createElement('div');
          el.className = 'strv-cut-tag';
          el.dataset.newest = String(tagPlan.newest);
          el.textContent = tagPlan.text;
          el.setAttribute('aria-hidden', 'true');
          cutTags.push({ marker: new Marker({ element: el, anchor: 'center' }).setLngLat(spots[0] as [number, number]).addTo(map), el, spots });
        });
      } else {
        stopAnim();
        src('cuts-past').setData(asFeature(EMPTY_LINES));
        src('cut-new').setData(asFeature(EMPTY_LINES));
      }
    }

    drawBalance(next);

    if (!prev || prev.cut !== next.cut || planShown(prev) !== plan) layoutLabels();

    // The 119th Congress districts, display only.
    if (next.enacted) {
      if (prev?.enacted !== next.enacted) src('enacted').setData(asFeature(next.enacted.lines));
      map.setLayoutProperty('enacted', 'visibility', 'visible');
    } else {
      map.setLayoutProperty('enacted', 'visibility', 'none');
    }

    // The visitor's address, when one was found in this state: a pin on the current view, no camera move.
    if (next.located) {
      if (!pin) {
        const el = document.createElement('div');
        el.className = 'strv-pin';
        el.setAttribute('aria-hidden', 'true');
        pin = new Marker({ element: el, anchor: 'center' });
      }
      pin!.setLngLat(next.located as [number, number]).addTo(map);
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
      zoomToMove() {
        if (!ready || !moveBounds) return;
        const [w, s, e, n] = moveBounds;
        userMoved = true;
        map.fitBounds([[w, s], [e, n]], { padding: 80, maxZoom: 15 });
      },
      destroy() {
        stopAnim();
        resizeObs?.disconnect();
        stopWatchingZoom();
        map.remove();
      },
    });
  });
}
