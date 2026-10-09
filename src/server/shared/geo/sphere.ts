import { asin, atan, atan2, cos, hypot2, sin } from '../detmath/index.js';

/** A position as [longitude, latitude] in degrees (x first, as in GeoJSON). */
export type LonLat = readonly [lon: number, lat: number];
/** A point on the tangent plane of the unit sphere, in radii (dimensionless); multiply by EARTH_RADIUS_M for meters. */
export type Vec2 = readonly [x: number, y: number];

/** Mean Earth radius in meters, 6,371,008.8 m: the IUGG (International Union of Geodesy and Geophysics) mean radius R1. */
export const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

export interface Gnomonic {
  forward(p: LonLat): Vec2;
  inverse(v: Vec2): LonLat;
}

/**
 * Gnomonic projection on the unit sphere, tangent at `center`: every great circle becomes a straight line.
 * forward throws a RangeError when the point is on or beyond the horizon (cos of its angular distance from the
 * center <= 0), where the projection is undefined. That is a caller contract: callers keep their points within
 * 90 degrees of the center (createContext turns the error into a DataError).
 */
export function gnomonic(center: LonLat): Gnomonic {
  const lon0 = center[0] * RAD;
  const lat0 = center[1] * RAD;
  const sinLat0 = sin(lat0);
  const cosLat0 = cos(lat0);
  return {
    forward([lon, lat]) {
      const l = lon * RAD - lon0;
      const p = lat * RAD;
      const sinP = sin(p), cosP = cos(p), cosL = cos(l);
      const cosc = sinLat0 * sinP + cosLat0 * cosP * cosL;
      if (cosc <= 0) throw new RangeError('point is 90 degrees or more from the projection center');
      return [
        (cosP * sin(l)) / cosc,
        (cosLat0 * sinP - sinLat0 * cosP * cosL) / cosc,
      ];
    },
    inverse([x, y]) {
      const rho = hypot2(x, y);
      if (rho === 0) return [center[0], center[1]];
      const c = atan(rho);
      const sinc = sin(c);
      const cosc = cos(c);
      const lat = asin(cosc * sinLat0 + (y * sinc * cosLat0) / rho);
      const lon = lon0 + atan2(x * sinc, rho * cosLat0 * cosc - y * sinLat0 * sinc);
      return [lon / RAD, lat / RAD];
    },
  };
}

/**
 * Great-circle distance in meters between two points, by the haversine formula (well conditioned for short
 * distances). Math.min(1, ...) clamps the asin argument: for near-antipodal points rounding can push it just
 * above 1, where asin would return NaN.
 */
export function greatCircleDistance(a: LonLat, b: LonLat): number {
  const p1 = a[1] * RAD;
  const p2 = b[1] * RAD;
  const dp = p2 - p1;
  const dl = (b[0] - a[0]) * RAD;
  const sp = sin(dp / 2), sl = sin(dl / 2);
  const h = sp * sp + cos(p1) * cos(p2) * (sl * sl);
  return 2 * EARTH_RADIUS_M * asin(Math.min(1, Math.sqrt(h)));
}
