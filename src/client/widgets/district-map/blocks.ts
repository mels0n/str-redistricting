import type { ExpressionSpecification, FilterSpecification, LayerSpecification, VectorSourceSpecification } from 'maplibre-gl';
import { tokens, dataUrl, formatInt } from '../../shared';
import type { Plan } from '../../shared';

/**
 * The border-blocks layer: the outlines of the Census blocks that sit on a district line, from `<state>/blocks.pmtiles`.
 * The tileset has one zoom level, BLOCKS_ZOOM, and the layer shows from there up (MapLibre overzooms the tiles past it).
 * A state published before the file existed has none; the map then goes without the layer, silently.
 * Must match TILE_MAXZOOM in src/server/features/publish/tiles.ts, the one zoom the publisher writes blocks.pmtiles at
 * (the client cannot import it; tests/client/detail-source-zooms.test.ts checks they are equal).
 */
export const BLOCKS_ZOOM = 13;
export const BLOCKS_SOURCE = 'blocks';
export const BLOCKS_LINE_LAYER = 'blocks-line';
export const BLOCKS_HOVER_LAYER = 'blocks-hover';
/** Invisible fill the pointer picks blocks from: a line layer cannot be hit inside a block. */
export const BLOCKS_PICK_LAYER = 'blocks-pick';
const SOURCE_LAYER = 'blocks';

export function blocksUrl(abbr: string): string {
  return `pmtiles://${dataUrl(`${abbr}/blocks.pmtiles`)}`;
}

/** A tile template, like the detail source, so the file's bounds do not clamp Alaska. One zoom level, 13. */
export function blocksSource(abbr: string): VectorSourceSpecification {
  return { type: 'vector', tiles: [`${blocksUrl(abbr)}/{z}/{x}/{y}`], minzoom: BLOCKS_ZOOM, maxzoom: BLOCKS_ZOOM };
}

const NO_BLOCK: FilterSpecification = ['==', ['get', 'geoid'], ''];

/** The block with this GEOID, or none for null. */
export function blockFilter(geoid: string | null): FilterSpecification {
  return geoid === null ? NO_BLOCK : ['==', ['get', 'geoid'], geoid];
}

const LINE_WIDTH: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], BLOCKS_ZOOM, 0.6, 17, 1.4];

/** The layers, bottom first. Outline in the secondary ink, a faint wash on the hovered block, and the invisible pick fill. */
export function blocksLayerSpecs(): LayerSpecification[] {
  const base = { source: BLOCKS_SOURCE, 'source-layer': SOURCE_LAYER, minzoom: BLOCKS_ZOOM } as const;
  return [
    { ...base, id: BLOCKS_PICK_LAYER, type: 'fill', paint: { 'fill-color': tokens.ink, 'fill-opacity': 0 } },
    { ...base, id: BLOCKS_HOVER_LAYER, type: 'fill', filter: NO_BLOCK, paint: { 'fill-color': tokens.ink, 'fill-opacity': 0.1 } },
    {
      ...base,
      id: BLOCKS_LINE_LAYER,
      type: 'line',
      layout: { 'line-join': 'round' },
      paint: { 'line-color': tokens.ink2, 'line-width': LINE_WIDTH, 'line-opacity': 0.7 },
    },
  ];
}

export const BLOCKS_LAYERS = [BLOCKS_PICK_LAYER, BLOCKS_HOVER_LAYER, BLOCKS_LINE_LAYER];

/** Whether a state has a blocks.pmtiles at all: a state with one seat has no district line, so none is published. */
export function hasBorderBlocks(seats: number): boolean {
  return seats > 1;
}

/** Whether the layer is on screen: zoomed in far enough, tiles not failed, and no replay (its colors mean pieces or moves, not the two plans). */
export function blocksShown(zoom: number, failed: boolean, replay: boolean): boolean {
  return !failed && !replay && zoom >= BLOCKS_ZOOM;
}

/** A map error that comes from the blocks source, while the layer is not already dropped. */
export function shouldDropBlocks(event: unknown, failed: boolean): boolean {
  return !failed && (event as { sourceId?: string } | null)?.sourceId === BLOCKS_SOURCE;
}

export interface BlockInfo {
  geoid: string;
  pop: number;
  /** The block's district in the plan on screen. */
  district: number | null;
}

/** Reads a picked feature's properties for the plan on screen; null when it is not a block record. */
export function blockInfo(props: Record<string, unknown> | null | undefined, plan: Plan): BlockInfo | null {
  if (!props || typeof props.geoid !== 'string' || props.geoid === '') return null;
  const d = props[plan];
  return {
    geoid: props.geoid,
    pop: typeof props.pop === 'number' ? props.pop : 0,
    district: typeof d === 'number' ? d : null,
  };
}

/** The tooltip's lines: the block, its people, its district in the plan on screen. */
export function blockTip(info: BlockInfo, plan: Plan): string[] {
  const where = plan === 'finished' ? 'finished map' : 'before balancing';
  return [
    `Block ${info.geoid}`,
    `${formatInt(info.pop)} ${info.pop === 1 ? 'person' : 'people'}`,
    info.district === null ? `No district (${where})` : `District ${info.district} (${where})`,
  ];
}
