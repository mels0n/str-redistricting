import { describe, expect, it } from 'vitest';
import { crossesAntimeridian, unwrapCoordinates, unwrapFeatures, unwrapLon } from '../../../src/server/features/publish/antimeridian.js';

describe('antimeridian unwrapping for display copies', () => {
  it('names only Alaska', () => {
    expect(crossesAntimeridian('AK')).toBe(true);
    expect(['HI', 'WA', 'CA', 'DE'].some(crossesAntimeridian)).toBe(false);
  });

  it('continues eastern longitudes past -180 and leaves western ones alone', () => {
    expect(unwrapLon(179.5)).toBeCloseTo(-180.5, 10);
    expect(unwrapLon(172.3)).toBeCloseTo(-187.7, 10);
    expect(unwrapLon(-179.2)).toBe(-179.2);
    expect(unwrapLon(-150)).toBe(-150);
  });

  it('shifts every position of nested coordinates and keeps latitudes', () => {
    const polygon = [[[179.5, 51], [-179.5, 51.5], [-179.5, 52], [179.5, 51]]];
    expect(unwrapCoordinates(polygon)).toEqual([[[-180.5, 51], [-179.5, 51.5], [-179.5, 52], [-180.5, 51]]]);
    expect(polygon[0]![0]).toEqual([179.5, 51]);
  });

  it('copies features with the shifted geometry and their other fields', () => {
    const out = unwrapFeatures([{ properties: { a: 1 }, geometry: { type: 'Polygon', coordinates: [[[172, 52], [173, 52], [173, 53], [172, 52]]] } }]);
    expect(out[0]!.properties).toEqual({ a: 1 });
    expect(out[0]!.geometry).toEqual({ type: 'Polygon', coordinates: [[[-188, 52], [-187, 52], [-187, 53], [-188, 52]]] });
  });
});
