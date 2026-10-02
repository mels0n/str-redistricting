import { describe, expect, it } from 'vitest';
import type { Feature, Polygon } from 'geojson';
import { districtsAt } from '../../src/client/entities/plan';

const box = (x0: number, x1: number, district: number): Feature<Polygon, { district: number }> => ({
  type: 'Feature',
  properties: { district },
  geometry: { type: 'Polygon', coordinates: [[[x0, 0], [x1, 0], [x1, 1], [x0, 1], [x0, 0]]] },
});

// Finished: district 1 spans x 0..6, district 2 spans 6..10.
// Before balancing: the border sits at x = 4, so a point at x = 5 changes district.
const plans = {
  finished: { features: [box(0, 6, 1), box(6, 10, 2)] },
  before: { features: [box(0, 4, 1), box(4, 10, 2)] },
};

describe('districtsAt', () => {
  it('answers separately for the finished map and the plan before balancing', () => {
    expect(districtsAt(plans, [5, 0.5])).toEqual({ finished: 1, before: 2 });
    expect(districtsAt(plans, [2, 0.5])).toEqual({ finished: 1, before: 1 });
    expect(districtsAt(plans, [8, 0.5])).toEqual({ finished: 2, before: 2 });
  });
  it('is null under a plan whose shapes do not contain the point', () => {
    expect(districtsAt(plans, [12, 0.5])).toEqual({ finished: null, before: null });
    const gap = { finished: plans.finished, before: { features: [box(0, 4, 1)] } };
    expect(districtsAt(gap, [5, 0.5])).toEqual({ finished: 1, before: null });
  });
});
