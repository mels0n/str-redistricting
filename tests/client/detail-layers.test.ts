import { describe, expect, it, vi } from 'vitest';
import { createExpression, featureFilter, validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import {
  DETAIL_ZOOM,
  DETAIL_SOURCE,
  fadeIn,
  fadeOut,
  FILL_OPACITY,
  fillFadeIn,
  fillFadeOut,
  bordersFilter,
  outlineFilter,
  selectedFilter,
  detailUrl,
  detailSource,
  detailLayerSpecs,
  fadedPaint,
  setDistrictState,
  dropDetail,
  shouldDropDetail,
  twinVisibility,
} from '../../src/client/widgets/district-map/detail';

const keeps = (filter: Parameters<typeof featureFilter>[0], a: number, b: number): boolean =>
  featureFilter(filter, 'layers[0].filter').filter({ zoom: 0 } as never, { type: 2, properties: { a, b } } as never);

describe('detail filters', () => {
  it('keeps every interior arc when no piece colouring applies', () => {
    const f = bordersFilter(null);
    expect(keeps(f, 1, 2)).toBe(true);
    expect(keeps(f, 3, 7)).toBe(true);
    expect(keeps(f, 2, 0)).toBe(false);
  });
  it('keeps only arcs between different pieces in cut mode', () => {
    const f = bordersFilter([0, 0, 1]);
    expect(keeps(f, 1, 2)).toBe(false);
    expect(keeps(f, 2, 3)).toBe(true);
    expect(keeps(f, 1, 3)).toBe(true);
    expect(keeps(f, 3, 0)).toBe(false);
  });
  it('outline keeps only the state edge', () => {
    const f = outlineFilter();
    expect(keeps(f, 2, 0)).toBe(true);
    expect(keeps(f, 1, 2)).toBe(false);
  });
  it('selected keeps arcs touching the district and none for null', () => {
    expect(keeps(selectedFilter(3), 3, 5)).toBe(true);
    expect(keeps(selectedFilter(3), 1, 3)).toBe(true);
    expect(keeps(selectedFilter(3), 3, 0)).toBe(true);
    expect(keeps(selectedFilter(3), 1, 2)).toBe(false);
    expect(keeps(selectedFilter(null), 1, 2)).toBe(false);
    expect(keeps(selectedFilter(null), 1, 0)).toBe(false);
  });
});

describe('detail fade', () => {
  it('fades start inside the tileset zoom range', () => {
    expect(DETAIL_ZOOM - 1).toBeGreaterThanOrEqual(7);
  });
  it('swaps the fills outright: at any zoom exactly one of the two is drawn, with the full state expression', () => {
    const at = (e: unknown, zoom: number, hover: boolean): number => {
      const r = createExpression(e as never, 'layers[0].paint.fill-opacity', { type: 'number', 'property-type': 'data-driven', expression: { interpolated: true, parameters: ['zoom', 'feature'] } } as never);
      if (r.result !== 'success') throw new Error(JSON.stringify(r.value));
      return r.value.evaluate({ zoom }, { type: 3, properties: {} } as never, { hover }) as number;
    };
    for (let z = 0; z <= 16; z += 0.25) {
      for (const hover of [false, true]) {
        const s = at(fillFadeOut(FILL_OPACITY), z, hover);
        const d = at(fillFadeIn(FILL_OPACITY), z, hover);
        expect(s === 0 ? 1 : 0).toBe(d === 0 ? 0 : 1);
        expect(s + d).toBeCloseTo(hover ? 0.82 : 1);
      }
    }
  });
  it('swaps the water cover outright: exactly one opaque cover is drawn at any zoom', () => {
    const at = (e: unknown, zoom: number): number => {
      const r = createExpression(e as never, 'layers[0].paint.fill-opacity', { type: 'number', 'property-type': 'data-constant', expression: { interpolated: true, parameters: ['zoom'] } } as never);
      if (r.result !== 'success') throw new Error(JSON.stringify(r.value));
      return r.value.evaluate({ zoom }) as number;
    };
    const cover = fadedPaint().find((p) => p.id === 'water-cover');
    expect(cover?.prop).toBe('fill-opacity');
    expect(cover?.base).toBe(1);
    expect(cover?.faded).toEqual(fillFadeOut(1));
    const twin = detailLayerSpecs().find((s) => s.layer.id === 'water-cover-detail');
    expect(twin?.after).toBe('water-cover');
    const detailOpacity = (twin?.layer as { paint: Record<string, unknown> }).paint['fill-opacity'];
    for (const z of [8, 8.5, 8.9, 9, 9.5, 13]) {
      const pair = [at(cover?.faded, z), at(detailOpacity, z)];
      expect(pair).toEqual(z < DETAIL_ZOOM ? [1, 0] : [0, 1]);
    }
  });
  it('multiplies the zoom fade into the existing expression', () => {
    const at = (e: unknown, zoom: number, hover: boolean): number => {
      const r = createExpression(e as never, 'layers[0].paint.fill-opacity', { type: 'number', 'property-type': 'data-driven', expression: { interpolated: true, parameters: ['zoom', 'feature'] } } as never);
      if (r.result !== 'success') throw new Error(JSON.stringify(r.value));
      return r.value.evaluate({ zoom }, { type: 3, properties: {} } as never, { hover }) as number;
    };
    const base = ['case', ['boolean', ['feature-state', 'hover'], false], 0.82, 1];
    expect(at(fadeOut(base as never), DETAIL_ZOOM - 1, true)).toBeCloseTo(0.82);
    expect(at(fadeOut(base as never), DETAIL_ZOOM + 1, true)).toBeCloseTo(0);
    expect(at(fadeIn(base as never), DETAIL_ZOOM - 1, false)).toBeCloseTo(0);
    expect(at(fadeIn(base as never), DETAIL_ZOOM + 1, false)).toBeCloseTo(1);
    expect(at(fadeIn(1), DETAIL_ZOOM - 0.25, false)).toBeCloseTo(0.5);
  });
});

describe('detail layers', () => {
  const style = (layers: unknown[]): unknown => ({
    version: 8,
    sources: { [DETAIL_SOURCE]: { type: 'vector', url: 'pmtiles://x' }, water: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
    layers,
  });
  it('every twin layer and every faded counterpart validates', () => {
    const specs = detailLayerSpecs().map((s) => s.layer);
    expect(specs.length).toBeGreaterThan(8);
    const faded = fadedPaint().map((p) => ({ id: p.id, type: p.prop.startsWith('fill') ? 'fill' : 'line', source: 'water', paint: { [p.prop]: p.faded } }));
    const errs = validateStyleMin(style([...specs, ...faded]) as never);
    expect(errs.map((e) => e.message)).toEqual([]);
  });
  it('twins start at the fade and sit after their counterparts', () => {
    for (const { layer, after } of detailLayerSpecs()) {
      expect(layer.minzoom).toBe(layer.type === 'fill' ? DETAIL_ZOOM - 1 : DETAIL_ZOOM - 0.5);
      expect(layer.id.endsWith('-detail')).toBe(true);
      expect(after).toBeTruthy();
    }
  });
  it('detailUrl points at the published pmtiles through the data root', () => {
    expect(detailUrl('CA')).toMatch(/^pmtiles:\/\/.*CA\/detail\.pmtiles$/);
  });
});

describe('detailSource', () => {
  it('is a tile template with the tileset zoom range and no bounds, so western Aleutian tiles load', () => {
    const src = detailSource('AK');
    expect(src.url).toBeUndefined();
    expect(src.bounds).toBeUndefined();
    expect(src.tiles).toEqual([`${detailUrl('AK')}/{z}/{x}/{y}`]);
    expect([src.minzoom, src.maxzoom]).toEqual([7, 13]);
  });
});

describe('detail state and fallback', () => {
  it('writes feature state to both sources', () => {
    const setFeatureState = vi.fn();
    setDistrictState({ setFeatureState } as never, 'before', 4, { dim: true });
    expect(setFeatureState).toHaveBeenCalledWith({ source: 'before', id: 4 }, { dim: true });
    expect(setFeatureState).toHaveBeenCalledWith({ source: DETAIL_SOURCE, sourceLayer: 'before', id: 4 }, { dim: true });
  });
  it('dropping detail hides twins and restores unfaded opacity', () => {
    const setLayoutProperty = vi.fn();
    const setPaintProperty = vi.fn();
    dropDetail({ setLayoutProperty, setPaintProperty } as never);
    const hidden = setLayoutProperty.mock.calls.map((c) => c[0] as string);
    expect(hidden).toContain('fill-finished-detail');
    expect(hidden).toContain('water-cover-detail');
    expect(hidden.every((id) => id.endsWith('-detail'))).toBe(true);
    const restored = setPaintProperty.mock.calls.map((c) => c[0] as string);
    expect(restored).toContain('fill-finished');
    expect(restored).toContain('borders');
    expect(setPaintProperty).toHaveBeenCalledWith('water-cover', 'fill-opacity', 1);
  });
});

describe('detail error wiring', () => {
  it('ignores a map error from another source or with none', () => {
    expect(shouldDropDetail({ sourceId: 'cuts' }, false)).toBe(false);
    expect(shouldDropDetail({ error: new Error('x') }, false)).toBe(false);
    expect(shouldDropDetail(null, false)).toBe(false);
  });
  it('drops on the first detail error and not again', () => {
    expect(shouldDropDetail({ sourceId: DETAIL_SOURCE }, false)).toBe(true);
    expect(shouldDropDetail({ sourceId: DETAIL_SOURCE }, true)).toBe(false);
  });
  it('shows only the shown plan twin, and none for any plan once the tiles failed', () => {
    expect(twinVisibility('finished', 'finished', false)).toBe('visible');
    expect(twinVisibility('finished', 'before', false)).toBe('none');
    expect(twinVisibility('before', 'before', false)).toBe('visible');
    for (const shown of ['finished', 'before'] as const) for (const plan of ['finished', 'before'] as const) expect(twinVisibility(shown, plan, true)).toBe('none');
  });
});
