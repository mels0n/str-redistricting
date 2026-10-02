/*
 * Deterministic elementary functions for the generator.
 *
 * ECMAScript lets an engine approximate Math.sin, Math.atan and the other transcendental functions,
 * so their last bit may differ between engines and versions. IEEE 754 requires +, -, *, / and sqrt
 * to be correctly rounded, so code built only from those, exact integer bit operations and
 * constants given as exact bit patterns returns the same double on every conforming engine. Every
 * function here is built that way.
 *
 * The algorithms are ports of fdlibm 5.3 (k_sin.c, k_cos.c, e_rem_pio2.c, s_sin.c, s_cos.c,
 * s_atan.c, e_atan2.c with FreeBSD's correction for huge |y/x| when x < 0, e_asin.c). Their error is
 * under 1 ulp of the exact value. Constants are written as their IEEE 754 bit patterns rather than
 * as decimal literals, because a decimal literal with more than 20 significant digits may be read
 * differently by different engines.
 *
 * Original fdlibm notice, kept as its license requires:
 * ====================================================
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 *
 * Developed at SunPro, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 */

const view = new DataView(new ArrayBuffer(8));

/** High 32 bits of a double (sign, exponent, top of the mantissa), as a signed integer. */
function hi(x: number): number {
  view.setFloat64(0, x);
  return view.getInt32(0);
}

/** The double with the given high and low 32-bit words. */
function make(h: number, l: number): number {
  view.setUint32(0, h >>> 0);
  view.setUint32(4, l >>> 0);
  return view.getFloat64(0);
}

// sin kernel coefficients
const S1 = make(0xbfc55555, 0x55555549);
const S2 = make(0x3f811111, 0x1110f8a6);
const S3 = make(0xbf2a01a0, 0x19c161d5);
const S4 = make(0x3ec71de3, 0x57b1fe7d);
const S5 = make(0xbe5ae5e6, 0x8a2b9ceb);
const S6 = make(0x3de5d93a, 0x5acfd57c);
// cos kernel coefficients
const C1 = make(0x3fa55555, 0x5555554c);
const C2 = make(0xbf56c16c, 0x16c15177);
const C3 = make(0x3efa01a0, 0x19cb1590);
const C4 = make(0xbe927e4f, 0x809c52ad);
const C5 = make(0x3e21ee9e, 0xbdb4b1c4);
const C6 = make(0xbda8fae9, 0xbe8838d4);
// pi/2 in three parts for argument reduction
const INVPIO2 = make(0x3fe45f30, 0x6dc9c883);
const PIO2_1 = make(0x3ff921fb, 0x54400000);
const PIO2_1T = make(0x3dd0b461, 0x1a626331);
const PIO2_2 = make(0x3dd0b461, 0x1a600000);
const PIO2_2T = make(0x3ba3198a, 0x2e037073);
const PIO2_3 = make(0x3ba3198a, 0x2e000000);
const PIO2_3T = make(0x397b839a, 0x252049c1);
/** High words of n * pi/2 for n = 1..32. */
const NPIO2_HW = [
  0x3ff921fb, 0x400921fb, 0x4012d97c, 0x401921fb, 0x401f6a7a, 0x4022d97c, 0x4025fdbb, 0x402921fb,
  0x402c463a, 0x402f6a7a, 0x4031475c, 0x4032d97c, 0x40346b9c, 0x4035fdbb, 0x40378fdb, 0x403921fb,
  0x403ab41b, 0x403c463a, 0x403dd85a, 0x403f6a7a, 0x40407e4c, 0x4041475c, 0x4042106c, 0x4042d97c,
  0x4043a28c, 0x40446b9c, 0x404534ac, 0x4045fdbb, 0x4046c6cb, 0x40478fdb, 0x404858eb, 0x404921fb,
];
// atan: atan(0.5), atan(1), atan(1.5), atan(inf) in high and low parts, and the series coefficients
const ATANHI = [make(0x3fddac67, 0x0561bb4f), make(0x3fe921fb, 0x54442d18), make(0x3fef730b, 0xd281f69b), make(0x3ff921fb, 0x54442d18)];
const ATANLO = [make(0x3c7a2b7f, 0x222f65e2), make(0x3c81a626, 0x33145c07), make(0x3c700788, 0x7af0cbbd), make(0x3c91a626, 0x33145c07)];
const AT = [
  make(0x3fd55555, 0x5555550d), make(0xbfc99999, 0x9998ebc4), make(0x3fc24924, 0x920083ff),
  make(0xbfbc71c6, 0xfe231671), make(0x3fb745cd, 0xc54c206e), make(0xbfb3b0f2, 0xaf749a6d),
  make(0x3fb10d66, 0xa0d03d51), make(0xbfadde2d, 0x52defd9a), make(0x3fa97b4b, 0x24760deb),
  make(0xbfa2b444, 0x2c6a6c2f), make(0x3f90ad3a, 0xe322da11),
];
// pi and friends
const PI = make(0x400921fb, 0x54442d18);
const PI_LO = make(0x3ca1a626, 0x33145c07);
const PIO2_HI = make(0x3ff921fb, 0x54442d18);
const PIO2_LO = make(0x3c91a626, 0x33145c07);
const PIO4_HI = make(0x3fe921fb, 0x54442d18);
// asin rational approximation
const PS0 = make(0x3fc55555, 0x55555555);
const PS1 = make(0xbfd4d612, 0x03eb6f7d);
const PS2 = make(0x3fc9c155, 0x0e884455);
const PS3 = make(0xbfa48228, 0xb5688f3b);
const PS4 = make(0x3f49efe0, 0x7501b288);
const PS5 = make(0x3f023de1, 0x0dfdf709);
const QS1 = make(0xc0033a27, 0x1c8a2d4b);
const QS2 = make(0x40002ae5, 0x9c598ac8);
const QS3 = make(0xbfe6066c, 0x1b8d0159);
const QS4 = make(0x3fb3b8c5, 0xb12e9282);

/** sin(x + y) for |x| <= pi/4, where y is the tail of x (iy = 0 when y is known to be zero). */
function kernelSin(x: number, y: number, iy: number): number {
  if ((hi(x) & 0x7fffffff) < 0x3e400000) return x; // |x| < 2^-27
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (iy === 0) return x + v * (S1 + z * r);
  return x - ((z * (0.5 * y - v * r) - y) - v * S1);
}

/** cos(x + y) for |x| <= pi/4, where y is the tail of x. */
function kernelCos(x: number, y: number): number {
  const ix = hi(x) & 0x7fffffff;
  if (ix < 0x3e400000) return 1; // |x| < 2^-27
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y)); // |x| < 0.3
  const qx = ix > 0x3fe90000 ? 0.28125 : make(ix - 0x00200000, 0);
  const hz = 0.5 * z - qx;
  const a = 1 - qx;
  return a - (hz - (z * r - x * y));
}

/** Largest |x| the reduction handles exactly: about 2^19 * pi/2 (823,549.6). */
const REDUCE_LIMIT_HW = 0x413921fb;
let red0 = 0;
let red1 = 0;

/** Reduce x to red0 + red1 in [-pi/4, pi/4] and return n with x = n * pi/2 + (red0 + red1). */
function remPio2(x: number): number {
  const hx = hi(x);
  const ix = hx & 0x7fffffff;
  if (ix <= 0x3fe921fb) { red0 = x; red1 = 0; return 0; }
  if (ix < 0x4002d97c) { // |x| < 3pi/4: n = +-1
    if (hx > 0) {
      let z = x - PIO2_1;
      if (ix !== 0x3ff921fb) { red0 = z - PIO2_1T; red1 = (z - red0) - PIO2_1T; }
      else { z -= PIO2_2; red0 = z - PIO2_2T; red1 = (z - red0) - PIO2_2T; }
      return 1;
    }
    let z = x + PIO2_1;
    if (ix !== 0x3ff921fb) { red0 = z + PIO2_1T; red1 = (z - red0) + PIO2_1T; }
    else { z += PIO2_2; red0 = z + PIO2_2T; red1 = (z - red0) + PIO2_2T; }
    return -1;
  }
  if (ix > REDUCE_LIMIT_HW) throw new RangeError(`detmath: |${x}| is beyond the supported trig range of 2^19 * pi/2`);
  const t0 = hx < 0 ? -x : x;
  const n = Math.floor(t0 * INVPIO2 + 0.5);
  let r = t0 - n * PIO2_1;
  let w = n * PIO2_1T; // first round, good to 85 bits
  if (n < 32 && ix !== NPIO2_HW[n - 1]) {
    red0 = r - w; // quick check: no cancellation
  } else {
    const j = ix >> 20;
    red0 = r - w;
    let i = j - ((hi(red0) >> 20) & 0x7ff);
    if (i > 16) { // second round, good to 118 bits
      let t = r;
      w = n * PIO2_2;
      r = t - w;
      w = n * PIO2_2T - ((t - r) - w);
      red0 = r - w;
      i = j - ((hi(red0) >> 20) & 0x7ff);
      if (i > 49) { // third round, good to 151 bits
        t = r;
        w = n * PIO2_3;
        r = t - w;
        w = n * PIO2_3T - ((t - r) - w);
        red0 = r - w;
      }
    }
  }
  red1 = (r - red0) - w;
  if (hx < 0) { red0 = -red0; red1 = -red1; return -n; }
  return n;
}

/** Sine of x in radians. Throws a RangeError for |x| above about 823,550 (far beyond any angle the generator uses). */
export function sin(x: number): number {
  const ix = hi(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelSin(x, 0, 0);
  if (ix >= 0x7ff00000) return NaN;
  const n = remPio2(x);
  switch (n & 3) {
    case 0: return kernelSin(red0, red1, 1);
    case 1: return kernelCos(red0, red1);
    case 2: return -kernelSin(red0, red1, 1);
    default: return -kernelCos(red0, red1);
  }
}

/** Cosine of x in radians. Throws a RangeError for |x| above about 823,550. */
export function cos(x: number): number {
  const ix = hi(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelCos(x, 0);
  if (ix >= 0x7ff00000) return NaN;
  const n = remPio2(x);
  switch (n & 3) {
    case 0: return kernelCos(red0, red1);
    case 1: return -kernelSin(red0, red1, 1);
    case 2: return -kernelCos(red0, red1);
    default: return kernelSin(red0, red1, 1);
  }
}

/** Arctangent, in radians in [-pi/2, pi/2]. */
export function atan(x: number): number {
  const hx = hi(x);
  const ix = hx & 0x7fffffff;
  let id: number;
  if (ix >= 0x44100000) { // |x| >= 2^66
    if (x !== x) return x;
    return hx > 0 ? ATANHI[3]! + ATANLO[3]! : -ATANHI[3]! - ATANLO[3]!;
  }
  if (ix < 0x3fdc0000) { // |x| < 0.4375
    if (ix < 0x3e200000) return x; // |x| < 2^-29
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) { // |x| < 1.1875
      if (ix < 0x3fe60000) { id = 0; x = (2 * x - 1) / (2 + x); } // 7/16 <= |x| < 11/16
      else { id = 1; x = (x - 1) / (x + 1); } // 11/16 <= |x| < 19/16
    } else if (ix < 0x40038000) { id = 2; x = (x - 1.5) / (1 + 1.5 * x); } // |x| < 2.4375
    else { id = 3; x = -1 / x; } // 2.4375 <= |x| < 2^66
  }
  const z = x * x;
  const w = z * z;
  const s1 = z * (AT[0]! + w * (AT[2]! + w * (AT[4]! + w * (AT[6]! + w * (AT[8]! + w * AT[10]!)))));
  const s2 = w * (AT[1]! + w * (AT[3]! + w * (AT[5]! + w * (AT[7]! + w * AT[9]!))));
  if (id < 0) return x - x * (s1 + s2);
  const r = ATANHI[id]! - ((x * (s1 + s2) - ATANLO[id]!) - x);
  return hx < 0 ? -r : r;
}

/** Angle of the point (x, y) from the positive x axis, in radians in [-pi, pi]. */
export function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return x + y;
  if (x === 1) return atan(y);
  const hx = hi(x);
  const hy = hi(y);
  let m = ((hy >> 31) & 1) | ((hx >> 30) & 2); // 2 * sign(x) + sign(y)
  if (y === 0) {
    if (m < 2) return y; // atan2(+-0, +anything) = +-0
    return m === 2 ? PI : -PI; // atan2(+-0, -anything) = +-pi
  }
  if (x === 0) return hy < 0 ? -PIO2_HI : PIO2_HI;
  if (x === Infinity || x === -Infinity) {
    if (y === Infinity || y === -Infinity) return [PIO4_HI, -PIO4_HI, 3 * PIO4_HI, -3 * PIO4_HI][m]!;
    return [0, -0, PI, -PI][m]!;
  }
  if (y === Infinity || y === -Infinity) return hy < 0 ? -PIO2_HI : PIO2_HI;
  const k = ((hy & 0x7fffffff) - (hx & 0x7fffffff)) >> 20;
  let z: number;
  if (k > 60) { z = PIO2_HI + 0.5 * PI_LO; m &= 1; } // |y/x| > 2^60
  else if (hx < 0 && k < -60) z = 0; // |y|/x < -2^60
  else z = atan(Math.abs(y / x));
  switch (m) {
    case 0: return z;
    case 1: return -z;
    case 2: return PI - (z - PI_LO);
    default: return (z - PI_LO) - PI;
  }
}

/** Arcsine, in radians in [-pi/2, pi/2]; NaN outside [-1, 1]. */
export function asin(x: number): number {
  const hx = hi(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) { // |x| >= 1
    if (x === 1 || x === -1) return x * PIO2_HI + x * PIO2_LO;
    return NaN;
  }
  if (ix < 0x3fe00000) { // |x| < 0.5
    if (ix < 0x3e400000) return x; // |x| < 2^-27
    const t = x * x;
    const p = t * (PS0 + t * (PS1 + t * (PS2 + t * (PS3 + t * (PS4 + t * PS5)))));
    const q = 1 + t * (QS1 + t * (QS2 + t * (QS3 + t * QS4)));
    return x + x * (p / q);
  }
  // 0.5 <= |x| < 1
  const w0 = 1 - Math.abs(x);
  const t = w0 * 0.5;
  const p = t * (PS0 + t * (PS1 + t * (PS2 + t * (PS3 + t * (PS4 + t * PS5)))));
  const q = 1 + t * (QS1 + t * (QS2 + t * (QS3 + t * QS4)));
  const s = Math.sqrt(t);
  let r: number;
  if (ix >= 0x3fef3333) { // |x| > 0.975
    r = PIO2_HI - (2 * (s + s * (p / q)) - PIO2_LO);
  } else {
    const w = make(hi(s), 0);
    const c = (t - w * w) / (s + w);
    const pp = 2 * s * (p / q) - (PIO2_LO - 2 * c);
    const qq = PIO4_HI - 2 * w;
    r = PIO4_HI - (pp - qq);
  }
  return hx > 0 ? r : -r;
}

/**
 * sqrt(x*x + y*y), which is correctly rounded at every step and so the same everywhere, unlike the
 * engine's hypot. It does not guard against overflow or underflow of the squares, so it is meant
 * for magnitudes between about 1e-150 and 1e150; the generator's coordinates are gnomonic plane
 * values and degree differences of order 1, far inside that range.
 */
export function hypot2(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}
