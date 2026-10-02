import { describe, expect, it } from 'vitest';
import { parseBlockFeature } from '../../../src/server/entities/census-block/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';

const square = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };

describe('parseBlockFeature', () => {
  it('reads GEOID, population, internal point and rings', () => {
    const b = parseBlockFeature(
      { GEOID20: '080010078011000', POP20: 42, INTPTLAT20: '+39.5000000', INTPTLON20: '-104.9000000' },
      square,
    );
    expect(b).toEqual({ geoid: '080010078011000', pop: 42, point: [-104.9, 39.5], rings: square.coordinates });
  });
  it('flattens multipolygons into rings', () => {
    const b = parseBlockFeature(
      { GEOID20: '080010078011001', POP20: 0, INTPTLAT20: '+39.5', INTPTLON20: '-104.9' },
      { type: 'MultiPolygon', coordinates: [square.coordinates, square.coordinates] },
    );
    expect(b.rings).toHaveLength(2);
  });
  it('fails loudly when population is missing', () => {
    expect(() => parseBlockFeature({ GEOID20: '080010078011000', INTPTLAT20: '+1', INTPTLON20: '-1' }, square))
      .toThrow(DataError);
  });
});
