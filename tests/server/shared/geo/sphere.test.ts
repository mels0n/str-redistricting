import { describe, expect, it } from 'vitest';
import { gnomonic, greatCircleDistance } from '../../../../src/server/shared/geo/index.js';

describe('greatCircleDistance', () => {
  it('one degree of latitude is ~111,195 m', () => {
    expect(greatCircleDistance([0, 0], [0, 1])).toBeCloseTo(111_195.08, 0);
  });
  it('is zero for identical points', () => {
    expect(greatCircleDistance([-105, 39], [-105, 39])).toBe(0);
  });
});

describe('gnomonic', () => {
  const proj = gnomonic([-105.5, 39]);
  it('maps the center to the origin', () => {
    const [x, y] = proj.forward([-105.5, 39]);
    expect(x).toBeCloseTo(0, 12);
    expect(y).toBeCloseTo(0, 12);
  });
  it('round-trips points', () => {
    for (const p of [[-109, 41], [-102, 37], [-104.9, 39.7]] as const) {
      const back = proj.inverse(proj.forward(p));
      expect(back[0]).toBeCloseTo(p[0], 9);
      expect(back[1]).toBeCloseTo(p[1], 9);
    }
  });
  it('maps great circles to straight lines (three points on a meridian are collinear)', () => {
    const a = proj.forward([-106, 37]);
    const b = proj.forward([-106, 39]);
    const c = proj.forward([-106, 41]);
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    expect(Math.abs(cross)).toBeLessThan(1e-12);
  });
  it('rejects points 90 degrees or more from the center', () => {
    expect(() => proj.forward([74.5, -39])).toThrow(RangeError);
  });
});
