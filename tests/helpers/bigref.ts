/**
 * High-precision reference values for sin, cos, atan, asin and atan2, in BigInt fixed point with
 * 320 fraction bits, and the error of a double against them in units in the last place (ulp).
 * Slow but exact enough: every reference is within about 2^-300 of the true value.
 */
const P = 320n;
const ONE = 1n << P;
const view = new DataView(new ArrayBuffer(8));

/** The double x as an exact fixed-point value (fraction bits beyond P are truncated; only matters below 2^-320). */
export function toFixed(x: number): bigint {
  if (x === 0) return 0n;
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0);
  const neg = bits >> 63n === 1n;
  const exp = Number((bits >> 52n) & 0x7ffn);
  let mant = bits & 0xfffffffffffffn;
  let e: number;
  if (exp === 0) e = -1074;
  else { mant |= 1n << 52n; e = exp - 1075; }
  const shift = BigInt(e) + P;
  const v = shift >= 0n ? mant << shift : mant >> -shift;
  return neg ? -v : v;
}

const mul = (a: bigint, b: bigint): bigint => (a * b) >> P;
const div = (a: bigint, b: bigint): bigint => (a << P) / b;

function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError('negative');
  if (n < 2n) return n;
  let x = 1n << (BigInt(n.toString(2).length) / 2n + 1n);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}
const sqrt = (a: bigint): bigint => isqrt(a << P);

/** atan by its Taylor series; converges fast for |x| <= 0.2. */
function atanSeries(x: bigint): bigint {
  const x2 = mul(x, x);
  let term = x, sum = 0n;
  for (let k = 0n; term !== 0n; k++) {
    sum += (k & 1n ? -term : term) / (2n * k + 1n);
    term = mul(term, x2);
  }
  return sum;
}

export const PI = 16n * atanSeries(div(ONE, 5n * ONE)) - 4n * atanSeries(div(ONE, 239n * ONE));
const HALF_PI = PI / 2n;

export function atanRef(x: bigint): bigint {
  if (x < 0n) return -atanRef(-x);
  if (x > ONE) return HALF_PI - atanRef(div(ONE, x));
  // atan(x) = 2 atan(x / (1 + sqrt(1 + x^2))), twice: |x| <= tan(pi/16) < 0.2.
  let r = x;
  for (let i = 0; i < 2; i++) r = div(r, ONE + sqrt(ONE + mul(r, r)));
  return 4n * atanSeries(r);
}

export function sinRef(x: bigint): bigint {
  // Reduce to [-pi, pi], then sum the Taylor series.
  const twoPi = 2n * PI;
  let r = x % twoPi;
  if (r > PI) r -= twoPi;
  if (r < -PI) r += twoPi;
  const r2 = mul(r, r);
  let term = r, sum = 0n;
  for (let k = 1n; term !== 0n; k += 2n) {
    sum += term;
    term = -mul(term, r2) / ((k + 1n) * (k + 2n));
  }
  return sum;
}

export const cosRef = (x: bigint): bigint => sinRef(x + HALF_PI);

export function asinRef(x: bigint): bigint {
  if (x === ONE) return HALF_PI;
  if (x === -ONE) return -HALF_PI;
  return atanRef(div(x, sqrt(ONE - mul(x, x))));
}

export function atan2Ref(y: bigint, x: bigint): bigint {
  if (x === 0n) return y < 0n ? -HALF_PI : HALF_PI;
  const a = atanRef(div(y, x));
  if (x > 0n) return a;
  return y < 0n ? a - PI : a + PI;
}

/** |d - ref| in ulps of d (d must be a normal, nonzero double). */
export function ulpError(d: number, ref: bigint): number {
  view.setFloat64(0, d);
  const exp = Number((view.getBigUint64(0) >> 52n) & 0x7ffn);
  const ulpShift = BigInt(exp - 1075) + P; // ulp(d) = 2^(exp - 1075) for normal d
  const diff = toFixed(d) - ref;
  const err = diff < 0n ? -diff : diff;
  return ulpShift >= 0n ? Number(err) / Number(1n << ulpShift) : Number(err << -ulpShift);
}

/** The double nearest a fixed-point value (ties to even): the correctly rounded result. */
export function roundToDouble(ref: bigint): number {
  if (ref === 0n) return 0;
  const neg = ref < 0n;
  const a = neg ? -ref : ref;
  const shift = BigInt(a.toString(2).length) - 53n;
  let m: bigint;
  if (shift <= 0n) m = a << -shift;
  else {
    m = a >> shift;
    const rem = a - (m << shift), half = 1n << (shift - 1n);
    if (rem > half || (rem === half && (m & 1n) === 1n)) m += 1n;
  }
  // m has 53 or 54 bits; value = m * 2^(shift - P), built exactly from its bit pattern.
  let e = shift - P;
  if (m === 1n << 53n) { m >>= 1n; e += 1n; }
  const biased = e + 52n + 1023n;
  if (biased <= 0n || biased >= 2047n) throw new RangeError('reference outside the normal double range');
  view.setBigUint64(0, ((neg ? 1n : 0n) << 63n) | (biased << 52n) | (m & 0xfffffffffffffn));
  return view.getFloat64(0);
}
