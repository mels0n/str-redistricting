import { asin, atan, atan2, cos, hypot2, sin } from '../detmath/index.js';

export type LonLat = readonly [lon: number, lat: number];
export type Vec2 = readonly [x: number, y: number];

export const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

export interface Gnomonic {
  forward(p: LonLat): Vec2;
  inverse(v: Vec2): LonLat;
}

/** Gnomonic projection on the unit sphere: every great circle becomes a straight line. */
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

export function greatCircleDistance(a: LonLat, b: LonLat): number {
  const p1 = a[1] * RAD;
  const p2 = b[1] * RAD;
  const dp = p2 - p1;
  const dl = (b[0] - a[0]) * RAD;
  const sp = sin(dp / 2), sl = sin(dl / 2);
  const h = sp * sp + cos(p1) * cos(p2) * (sl * sl);
  return 2 * EARTH_RADIUS_M * asin(Math.min(1, Math.sqrt(h)));
}
