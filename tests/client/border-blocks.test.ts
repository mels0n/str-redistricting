import { describe, expect, it } from 'vitest';
import { featureFilter } from '@maplibre/maplibre-gl-style-spec';
import {
  BLOCKS_LAYERS,
  BLOCKS_ZOOM,
  hasBorderBlocks,
  blocksShown,
  blocksSource,
  blocksLayerSpecs,
  blockFilter,
  blockInfo,
  blockTip,
  shouldDropBlocks,
} from '../../src/client/widgets/district-map/blocks';

const keeps = (filter: Parameters<typeof featureFilter>[0], geoid: string): boolean =>
  featureFilter(filter, 'layers[0].filter').filter({ zoom: 0 } as never, { type: 3, properties: { geoid } } as never);

describe('border blocks visibility (also the key rule)', () => {
  it('shows from zoom 13 up and not below', () => {
    expect(blocksShown(12.99, false, false)).toBe(false);
    expect(blocksShown(BLOCKS_ZOOM, false, false)).toBe(true);
    expect(blocksShown(16, false, false)).toBe(true);
  });
  it('is off once the tiles failed', () => {
    expect(blocksShown(15, true, false)).toBe(false);
  });
  it('is off in the cut and balancing replays', () => {
    expect(blocksShown(15, false, true)).toBe(false);
  });
});

describe('which states have border blocks', () => {
  it('is every state with more than one seat', () => {
    expect(hasBorderBlocks(1)).toBe(false);
    expect(hasBorderBlocks(2)).toBe(true);
    expect(hasBorderBlocks(52)).toBe(true);
  });
});

describe('border blocks source and layers', () => {
  it('is one zoom level, 13, so the map overzooms past it', () => {
    const s = blocksSource('RI');
    expect(s.minzoom).toBe(13);
    expect(s.maxzoom).toBe(13);
    expect(s.tiles?.[0]).toMatch(/^pmtiles:\/\/.*RI\/blocks\.pmtiles\/\{z\}\/\{x\}\/\{y\}$/);
  });
  it('lists the layer ids it adds', () => {
    expect(blocksLayerSpecs().map((l) => l.id)).toEqual(BLOCKS_LAYERS);
  });
  it('draws only from zoom 13 and reads the blocks layer', () => {
    for (const l of blocksLayerSpecs()) {
      expect(l.minzoom).toBe(13);
      expect((l as { 'source-layer'?: string })['source-layer']).toBe('blocks');
    }
  });
  it('hover filter keeps only the named block', () => {
    expect(keeps(blockFilter('440070101001000'), '440070101001000')).toBe(true);
    expect(keeps(blockFilter('440070101001000'), '440070101001001')).toBe(false);
    expect(keeps(blockFilter(null), '440070101001000')).toBe(false);
  });
  it('drops only on an error from the blocks source, once', () => {
    expect(shouldDropBlocks({ sourceId: 'blocks' }, false)).toBe(true);
    expect(shouldDropBlocks({ sourceId: 'blocks' }, true)).toBe(false);
    expect(shouldDropBlocks({ sourceId: 'detail' }, false)).toBe(false);
    expect(shouldDropBlocks(null, false)).toBe(false);
  });
});

describe('border block hover content', () => {
  const props = { geoid: '440070101001000', pop: 1234, finished: 2, before: 1 };
  it('reads the district of the plan on screen', () => {
    expect(blockInfo(props, 'finished')?.district).toBe(2);
    expect(blockInfo(props, 'before')?.district).toBe(1);
  });
  it('formats the tooltip for each plan', () => {
    expect(blockTip(blockInfo(props, 'finished')!, 'finished')).toEqual(['Block 440070101001000', '1,234 people', 'District 2 (finished map)']);
    expect(blockTip(blockInfo(props, 'before')!, 'before')).toEqual(['Block 440070101001000', '1,234 people', 'District 1 (before balancing)']);
  });
  it('says person for one and copes with a missing district', () => {
    const info = blockInfo({ geoid: '1', pop: 1 }, 'finished')!;
    expect(info.district).toBeNull();
    expect(blockTip(info, 'finished')[1]).toBe('1 person');
    expect(blockTip(info, 'finished')[2]).toBe('No district (finished map)');
  });
  it('rejects features that are not block records', () => {
    expect(blockInfo(null, 'finished')).toBeNull();
    expect(blockInfo({ pop: 3 }, 'finished')).toBeNull();
    expect(blockInfo({ geoid: '' }, 'finished')).toBeNull();
  });
  it('has no em dashes in rendered copy', () => {
    const all = blockTip(blockInfo({ geoid: '1', pop: 0 }, 'before')!, 'before').join(' ');
    expect(all).not.toContain('—');
  });
});
