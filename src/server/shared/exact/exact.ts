/**
 * Exact signs of small products of coordinate differences.
 *
 * The exact sweep decides every "which comes first" question by the sign of (a - b)(c - d) - (e - f)(g - h) over
 * the coordinates as stored (doubles). Near a tie the rounded result is noise, so the sign is computed exactly:
 * first in ordinary arithmetic, accepted when it is larger than the worst-case rounding error; otherwise again in
 * integers. Every double is an integer multiple of 2^-1074, so scaling by 2^1074 turns the inputs into exact
 * BigInts. Only + - x are used, which are exact or correctly rounded on every engine.
 */

const BUF = new DataView(new ArrayBuffer(8));

/** x * 2^1074 as an exact BigInt. */
function big(x: number): bigint {
  BUF.setFloat64(0, x);
  const hi = BUF.getUint32(0), lo = BUF.getUint32(4);
  const exponent = (hi >>> 20) & 0x7ff;
  if (exponent === 0x7ff) throw new RangeError('exact arithmetic needs finite coordinates');
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (exponent !== 0) mant = (mant | (1n << 52n)) << BigInt(exponent - 1);
  return hi >>> 31 === 1 ? -mant : mant;
}

const sign = (v: bigint): number => (v > 0n ? 1 : v < 0n ? -1 : 0);

/** Times signOfDifference fell back to integers, in this thread since it started. Observation only. */
let fallbacks = 0;
export const exactFallbacks = (): number => fallbacks;

/**
 * Exact sign of (a - b)(c - d) - (e - f)(g - h). The float filter bound is about three times the standard error
 * bound for this expression ((3 + 16u)u with u = 2^-53); magnitudes small enough to reach subnormal numbers always
 * take the exact path, because relative bounds do not hold there.
 */
export function signOfDifference(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number): number {
  const t1 = (a - b) * (c - d), t2 = (e - f) * (g - h);
  const r = t1 - t2;
  const mag = Math.abs(t1) + Math.abs(t2);
  const bound = 1e-15 * mag;
  if (mag > 1e-280) {
    if (r > bound) return 1;
    if (-r > bound) return -1;
  }
  fallbacks++;
  return sign((big(a) - big(b)) * (big(c) - big(d)) - (big(e) - big(f)) * (big(g) - big(h)));
}

/** Exact sign of |a - b| |c - d| - |e - f| |g - h|. Always computed in integers, and not counted by exactFallbacks. */
export function signOfAbsDifference(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number): number {
  const abs = (v: bigint) => (v < 0n ? -v : v);
  return sign(abs(big(a) - big(b)) * abs(big(c) - big(d)) - abs(big(e) - big(f)) * abs(big(g) - big(h)));
}
