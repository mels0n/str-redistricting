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
  const sinLat0 = Math.sin(lat0);
  const cosLat0 = Math.cos(lat0);
  return {
    forward([lon, lat]) {
      const l = lon * RAD - lon0;
      const p = lat * RAD;
      const cosc = sinLat0 * Math.sin(p) + cosLat0 * Math.cos(p) * Math.cos(l);
      if (cosc <= 0) throw new RangeError('point is 90 degrees or more from the projection center');
      return [
        (Math.cos(p) * Math.sin(l)) / cosc,
        (cosLat0 * Math.sin(p) - sinLat0 * Math.cos(p) * Math.cos(l)) / cosc,
      ];
    },
    inverse([x, y]) {
      const rho = Math.hypot(x, y);
      if (rho === 0) return [center[0], center[1]];
      const c = Math.atan(rho);
      const sinc = Math.sin(c);
      const cosc = Math.cos(c);
      const lat = Math.asin(cosc * sinLat0 + (y * sinc * cosLat0) / rho);
      const lon = lon0 + Math.atan2(x * sinc, rho * cosLat0 * cosc - y * sinLat0 * sinc);
      return [lon / RAD, lat / RAD];
    },
  };
}

export function greatCircleDistance(a: LonLat, b: LonLat): number {
  const p1 = a[1] * RAD;
  const p2 = b[1] * RAD;
  const dp = p2 - p1;
  const dl = (b[0] - a[0]) * RAD;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
