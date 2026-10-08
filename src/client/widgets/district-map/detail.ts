import { addProtocol, type ExpressionSpecification, type VectorSourceSpecification, type FilterSpecification, type LayerSpecification, type Map as MlMap } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { tokens, dataUrl } from '../../shared';
import type { Plan } from '../../shared';

/**
 * Full-detail layers. Past DETAIL_ZOOM the map draws the published vector tiles (the exact district polygons and
 * the arcs between them) over the simplified in-memory shapes, crossfading the lines between the two and swapping the fills. The tileset covers
 * zooms 7 to 13, so the fade must begin at 7 or later (the fill layers load a level earlier than the lines fade).
 */
export const DETAIL_ZOOM = 9;
export const DETAIL_SOURCE = 'detail';
const FADE_FROM = DETAIL_ZOOM - 0.5;
/** The detail fills' layers start here, a level before they are drawn; see fillFadeIn. */
const FILL_FADE_FROM = DETAIL_ZOOM - 1;

const PLANS: readonly Plan[] = ['finished', 'before'];

type Opacity = ExpressionSpecification | number;

/** Opacity that is `value` below the fade and falls to nothing across it: the simplified layers. */
export function fadeOut(value: Opacity): ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], FADE_FROM, value, DETAIL_ZOOM, 0];
}

/** Opacity that rises from nothing to `value` across the fade: the detail layers. */
export function fadeIn(value: Opacity): ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], FADE_FROM, 0, DETAIL_ZOOM, value];
}

/**
 * Fill opacity depends on feature state (hover, dim), and MapLibre evaluates such an expression only at whole zoom
 * levels, so a fractional-zoom fade does not happen where it says. Crossfading two translucent fills would also stack
 * them (a dimmed district would read as barely dimmed). The fills therefore swap outright at DETAIL_ZOOM: exactly one
 * of the two is drawn at any zoom. Their colours are identical, so the swap shows only as the edge shift. The detail
 * fill's layer starts a level earlier, so its tiles are loaded (at opacity 0) before the swap.
 */
export function fillFadeIn(value: Opacity): ExpressionSpecification {
  return ['step', ['zoom'], 0, DETAIL_ZOOM, value];
}
export function fillFadeOut(value: Opacity): ExpressionSpecification {
  return ['step', ['zoom'], value, DETAIL_ZOOM, 0];
}

/** The opacities and widths the simplified layers already had; the twins reuse them. */
export const FILL_OPACITY: ExpressionSpecification = [
  'case',
  ['boolean', ['feature-state', 'hover'], false], 0.82,
  ['boolean', ['feature-state', 'dim'], false], 0.5,
  1,
];
export const BORDER_WIDTH: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 5, 0.9, 10, 1.6];
export const OUTLINE_WIDTH: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 5, 1.5, 10, 2.5];
const FILL_COLOR: ExpressionSpecification = ['coalesce', ['feature-state', 'fill'], tokens.quietFill];
const SELECTED_WIDTH = 3.5;

/** Interior arcs (`b > 0`); in the cut sequence only those between different pieces. `piece[i]` is the piece of district i + 1. */
export function bordersFilter(piece: readonly number[] | null): FilterSpecification {
  const interior: FilterSpecification = ['>', ['get', 'b'], 0];
  if (!piece || piece.length === 0) return ['all', interior, ['!=', ['get', 'a'], ['get', 'b']]];
  const of = (side: 'a' | 'b'): ExpressionSpecification => {
    const arms: (number | ExpressionSpecification)[] = [];
    piece.forEach((p, i) => arms.push(i + 1, p));
    return ['match', ['get', side], ...arms, -1] as unknown as ExpressionSpecification;
  };
  return ['all', interior, ['!=', of('a'), of('b')]];
}

/** The state edge: arcs with nothing on the far side. */
export function outlineFilter(): FilterSpecification {
  return ['==', ['get', 'b'], 0];
}

/** Arcs on either side of the chosen district; none when nothing is chosen. */
export function selectedFilter(district: number | null): FilterSpecification {
  const d = district ?? -1;
  return ['any', ['==', ['get', 'a'], d], ['==', ['get', 'b'], d]];
}

export function detailUrl(abbr: string): string {
  return `pmtiles://${dataUrl(`${abbr}/detail.pmtiles`)}`;
}

/**
 * The detail source as a tile template, not a tileset URL. A URL makes MapLibre take the file's bounds, and it clamps
 * them to the real world, which drops Alaska's tiles west of -180 (the Aleutians, drawn on the far world copy).
 * The zoom range is the tileset's own (7 to 13).
 */
export function detailSource(abbr: string): VectorSourceSpecification {
  return {
    type: 'vector',
    tiles: [`${detailUrl(abbr)}/{z}/{x}/{y}`],
    // Must match TILE_MINZOOM and TILE_MAXZOOM in src/server/features/publish/tiles.ts (a test checks it).
    minzoom: 7,
    maxzoom: 13,
    promoteId: { finished: 'district', before: 'district' },
  };
}

let registered = false;
/** Teaches MapLibre the pmtiles:// scheme; safe to call for every map. */
export function registerPmtiles(): void {
  if (registered) return;
  registered = true;
  const protocol = new Protocol();
  addProtocol('pmtiles', protocol.tile);
}

/** The layers that draw the detail tiles, each with the simplified layer it goes directly above. */
export function detailLayerSpecs(): { layer: LayerSpecification; after: string }[] {
  const out: { layer: LayerSpecification; after: string }[] = [];
  const base = { source: DETAIL_SOURCE, minzoom: FADE_FROM } as const;
  for (const plan of PLANS) {
    out.push({
      after: `fill-${plan}`,
      layer: {
        ...base,
        minzoom: FILL_FADE_FROM,
        id: `fill-${plan}-detail`,
        type: 'fill',
        'source-layer': plan,
        paint: { 'fill-color': FILL_COLOR, 'fill-opacity': fillFadeIn(FILL_OPACITY) },
      },
    });
  }
  for (const plan of PLANS) {
    out.push({
      after: 'borders',
      layer: {
        ...base,
        id: `borders-${plan}-detail`,
        type: 'line',
        'source-layer': `${plan}-arcs`,
        filter: bordersFilter(null),
        layout: { 'line-join': 'round' },
        paint: { 'line-color': tokens.ink, 'line-width': BORDER_WIDTH, 'line-opacity': fadeIn(1) },
      },
    });
  }
  for (const plan of PLANS) {
    out.push({
      after: 'outline',
      layer: {
        ...base,
        id: `outline-${plan}-detail`,
        type: 'line',
        'source-layer': `${plan}-arcs`,
        filter: outlineFilter(),
        layout: { 'line-join': 'round' },
        paint: { 'line-color': tokens.ink, 'line-width': OUTLINE_WIDTH, 'line-opacity': fadeIn(1) },
      },
    });
  }
  out.push({
    after: 'water-cover',
    layer: {
      ...base,
      minzoom: FILL_FADE_FROM,
      id: 'water-cover-detail',
      type: 'fill',
      'source-layer': 'water',
      // Opaque, so it swaps outright like the fills: a crossfade would let the borders show through mid-fade.
      paint: { 'fill-color': tokens.ground, 'fill-opacity': fillFadeIn(1) },
    },
  });
  for (const plan of PLANS) {
    out.push({
      after: `sel-${plan}`,
      layer: {
        ...base,
        id: `sel-${plan}-detail`,
        type: 'line',
        'source-layer': `${plan}-arcs`,
        filter: selectedFilter(null),
        layout: { 'line-join': 'round' },
        paint: { 'line-color': tokens.ink, 'line-width': SELECTED_WIDTH, 'line-opacity': fadeIn(1) },
      },
    });
  }
  return out;
}

/** The simplified layers' opacities: `faded` is what they carry while detail is available, `base` what they had before. */
export function fadedPaint(): { id: string; prop: 'fill-opacity' | 'line-opacity'; base: Opacity; faded: ExpressionSpecification }[] {
  const rows: { id: string; prop: 'fill-opacity' | 'line-opacity'; base: Opacity }[] = [];
  for (const plan of PLANS) rows.push({ id: `fill-${plan}`, prop: 'fill-opacity', base: FILL_OPACITY });
  rows.push({ id: 'borders', prop: 'line-opacity', base: 1 });
  rows.push({ id: 'outline', prop: 'line-opacity', base: 1 });
  rows.push({ id: 'water-cover', prop: 'fill-opacity', base: 1 });
  for (const plan of PLANS) rows.push({ id: `sel-${plan}`, prop: 'line-opacity', base: 1 });
  return rows.map((r) => ({ ...r, faded: r.prop === 'fill-opacity' ? fillFadeOut(r.base) : fadeOut(r.base) }));
}

/** Feature state for a district on both the simplified source and the detail tiles (their ids are the district number). */
export function setDistrictState(map: Pick<MlMap, 'setFeatureState'>, plan: Plan, id: number, state: Record<string, unknown>): void {
  map.setFeatureState({ source: plan, id }, state);
  map.setFeatureState({ source: DETAIL_SOURCE, sourceLayer: plan, id }, state);
}

/** A map error that means the detail tiles cannot be had: it comes from the detail source, and the layers are not already dropped. */
export function shouldDropDetail(event: unknown, failed: boolean): boolean {
  return !failed && (event as { sourceId?: string } | null)?.sourceId === DETAIL_SOURCE;
}

/** Visibility of the detail twin for `plan` while `planShown` is on screen: only the shown plan's, and none once the tiles failed. */
export function twinVisibility(planShown: Plan, plan: Plan, failed: boolean): 'visible' | 'none' {
  return !failed && plan === planShown ? 'visible' : 'none';
}

/** The tiles cannot be had: hide every detail layer and give the simplified ones back their unfaded opacity. */
export function dropDetail(map: Pick<MlMap, 'setLayoutProperty' | 'setPaintProperty'>): void {
  for (const { layer } of detailLayerSpecs()) map.setLayoutProperty(layer.id, 'visibility', 'none');
  for (const p of fadedPaint()) map.setPaintProperty(p.id, p.prop, p.base);
}
