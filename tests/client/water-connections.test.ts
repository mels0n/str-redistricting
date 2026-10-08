import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { featureFilter } from '@maplibre/maplibre-gl-style-spec';
import { DistrictStatsSchema } from '../../src/client/entities/plan/model';
import { BridgesSchema, linksIn, linksFeatures, type Bridges } from '../../src/client/entities/plan';
import { connectionText } from '../../src/client/widgets/district-ticket';
import {
  WATER_VEIL_DETAIL_LAYER,
  detailLayerSpecs,
  fadedPaint,
  selFillId,
  selFillVisibility,
  selectedFillFilter,
} from '../../src/client/widgets/district-map/detail';

const district = { district: 1, pop: 10, dev: 0, devPct: 0, contiguous: true, counties: [] };
describe('stats landParts', () => {
  it('parses with and without landParts, and rejects 0 or a fraction', () => {
    const ok = (extra: object) => {
      return DistrictStatsSchema.safeParse({ ...district, ...extra }).success;
    };
    expect(ok({})).toBe(true);
    expect(ok({ landParts: 1 })).toBe(true);
    expect(ok({ landParts: 3 })).toBe(true);
    expect(ok({ landParts: 0 })).toBe(false);
    expect(ok({ landParts: 1.5 })).toBe(false);
  });
});

const bridges: Bridges = {
  links: [
    { a: [-150, 61], b: [-151, 60], finished: [1, 1], before: [1, 2] },
    { a: [-160, 55], b: [-161, 55], finished: [2, 3], before: [2, 2] },
  ],
};

describe('bridges.json', () => {
  it('parses a file with links and one without', () => {
    expect(BridgesSchema.parse(bridges).links).toHaveLength(2);
    expect(BridgesSchema.parse({ links: [] }).links).toEqual([]);
  });
  it('rejects malformed links', () => {
    expect(BridgesSchema.safeParse({ links: [{ a: [1], b: [1, 2], finished: [1, 1], before: [1, 1] }] }).success).toBe(false);
    expect(BridgesSchema.safeParse({ links: [{ a: [1, 2], b: [1, 2], finished: [0, 1], before: [1, 1] }] }).success).toBe(false);
    expect(BridgesSchema.safeParse({}).success).toBe(false);
  });
});

describe('linksIn', () => {
  it('keeps links with both ends in the district, for the plan shown', () => {
    expect(linksIn(bridges, 'finished', 1)).toHaveLength(1);
    expect(linksIn(bridges, 'before', 1)).toHaveLength(0);
    expect(linksIn(bridges, 'before', 2)).toHaveLength(1);
    expect(linksIn(bridges, 'finished', 2)).toHaveLength(0);
    expect(linksIn(bridges, 'finished', 3)).toHaveLength(0);
  });
  it('is empty with nothing selected or no bridges', () => {
    expect(linksIn(bridges, 'finished', null)).toEqual([]);
    expect(linksIn(null, 'finished', 1)).toEqual([]);
  });
  it('makes one line and two end points per link', () => {
    const f = linksFeatures(linksIn(bridges, 'finished', 1));
    expect(f.lines.features[0]!.geometry.coordinates).toEqual([[-150, 61], [-151, 60]]);
    expect(f.ends.features).toHaveLength(2);
  });
});

describe('district card connection copy', () => {
  it('says plainly when one piece, across water, by a link, or both', () => {
    expect(connectionText({ contiguous: true, landParts: 1 }, false)).toBe('One connected piece');
    expect(connectionText({ contiguous: true }, false)).toBe('One connected piece');
    expect(connectionText({ contiguous: true, landParts: 2 }, false)).toBe('One connected piece, joined across water');
    expect(connectionText({ contiguous: true, landParts: 2 }, true)).toBe('One connected piece, joined across water and by a link to the nearest land');
    expect(connectionText({ contiguous: true, landParts: 1 }, true)).toBe('One connected piece, joined by a link to the nearest land');
    expect(connectionText({ contiguous: false, landParts: 2 }, true)).toBe('Not one connected piece');
  });
  it('has no em dash', () => {
    for (const p of [1, 2]) for (const l of [false, true]) expect(connectionText({ contiguous: true, landParts: p }, l)).not.toContain('—');
  });
});

describe('selected district fill layers', () => {
  const specs = detailLayerSpecs();
  it('has a detail twin per plan, placed after its simplified layer, filtered to the district', () => {
    for (const p of ['finished', 'before'] as const) {
      const s = specs.find((x) => x.layer.id === `${selFillId(p)}-detail`);
      expect(s?.after).toBe(selFillId(p));
      expect(s?.layer.type).toBe('fill');
      expect((s?.layer as { 'source-layer': string })['source-layer']).toBe(p);
    }
  });
  it('the simplified layers fade out like the other fills', () => {
    const ids = fadedPaint().map((r) => r.id);
    expect(ids).toContain('sel-fill-finished');
    expect(ids).toContain('sel-fill-before');
  });
  it('filter keeps only the selected district, and nothing when none', () => {
    const keeps = (f: Parameters<typeof featureFilter>[0], d: number): boolean =>
      featureFilter(f, 'x').filter({ zoom: 0 } as never, { type: 3, properties: { district: d } } as never);
    expect(keeps(selectedFillFilter(2), 2)).toBe(true);
    expect(keeps(selectedFillFilter(2), 3)).toBe(false);
    expect(keeps(selectedFillFilter(null), 1)).toBe(false);
  });
  it('is hidden in a replay', () => {
    expect(selFillVisibility(true, false)).toBe('visible');
    expect(selFillVisibility(true, true)).toBe('none');
    expect(selFillVisibility(false, false)).toBe('none');
  });
  it('map.ts adds them above the water veil and below enacted, the selected outline, island links and cuts', () => {
    const src = readFileSync('src/client/widgets/district-map/map.ts', 'utf8');
    const at = (needle: string): number => {
      const i = src.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const veil = at('id: WATER_VEIL_LAYER');
    const veilDetail = at('addDetailAfter(WATER_VEIL_LAYER)');
    const fill = at('id: selFillId(plan)');
    const enacted = at("id: 'enacted'");
    const links = at("id: 'island-links'");
    const outline = at('id: `sel-${plan}`');
    const cuts = at("id: 'cuts-past'");
    expect(veil).toBeLessThan(veilDetail);
    expect(veilDetail).toBeLessThan(fill);
    expect(fill).toBeLessThan(enacted);
    expect(enacted).toBeLessThan(links);
    expect(links).toBeLessThan(outline);
    expect(outline).toBeLessThan(cuts);
    expect(specs.some((s) => s.layer.id === WATER_VEIL_DETAIL_LAYER && s.after === 'water-veil')).toBe(true);
  });
});
