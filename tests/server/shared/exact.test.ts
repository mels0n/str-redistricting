import { describe, expect, it } from 'vitest';
import { exactFallbacks, signOfAbsDifference, signOfDifference } from '../../../src/server/shared/exact/index.js';

const view = new DataView(new ArrayBuffer(8));

/** The double as an exact (mantissa, exponent) pair: x = mant * 2^exp. */
function parts(x: number): { mant: bigint; exp: bigint } {
  view.setFloat64(0, x);
  const b = view.getBigUint64(0);
  const e = Number((b >> 52n) & 0x7ffn);
  const frac = b & 0xfffffffffffffn;
  const mant = e === 0 ? frac : frac | (1n << 52n);
  return { mant: b >> 63n === 1n ? -mant : mant, exp: BigInt(e === 0 ? -1074 : e - 1075) };
}

/** The sign of (a - b)(c - d) - (e - f)(g - h) by exact rational arithmetic: every value brought to the lowest exponent. */
function reference(v: readonly number[], abs = false): number {
  const ps = v.map(parts);
  const lo = ps.reduce((m, p) => (p.exp < m ? p.exp : m), 0n);
  const [a, b, c, d, e, f, g, h] = ps.map((p) => p.mant << (p.exp - lo));
  const ab = (x: bigint) => (abs && x < 0n ? -x : x);
  const r = ab(a! - b!) * ab(c! - d!) - ab(e! - f!) * ab(g! - h!);
  return r > 0n ? 1 : r < 0n ? -1 : 0;
}

/** A small deterministic generator, so a failure reproduces. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

/** A double with random sign and mantissa and a binary exponent in [lo, hi]. */
function randomDouble(rnd: () => number, lo: number, hi: number): number {
  const e = lo + Math.floor(rnd() * (hi - lo + 1));
  const frac = (BigInt(Math.floor(rnd() * 2 ** 26)) << 26n) | BigInt(Math.floor(rnd() * 2 ** 26));
  // Below the smallest normal exponent the number is subnormal: no implicit bit, fewer mantissa bits.
  const bits = e >= -1022 ? (BigInt(e + 1023) << 52n) | frac : frac >> BigInt(-1022 - e);
  view.setBigUint64(0, (rnd() < 0.5 ? 1n << 63n : 0n) | bits);
  return view.getFloat64(0);
}

const naive = (v: readonly number[]): number => Math.sign((v[0]! - v[1]!) * (v[2]! - v[3]!) - (v[4]! - v[5]!) * (v[6]! - v[7]!));
const sign = (v: readonly number[]) => signOfDifference(v[0]!, v[1]!, v[2]!, v[3]!, v[4]!, v[5]!, v[6]!, v[7]!);
const signAbs = (v: readonly number[]) => signOfAbsDifference(v[0]!, v[1]!, v[2]!, v[3]!, v[4]!, v[5]!, v[6]!, v[7]!);
const next = (x: number): number => { view.setFloat64(0, x); view.setBigUint64(0, view.getBigUint64(0) + (x >= 0 ? 1n : -1n)); return view.getFloat64(0); };

/** Eight values that make the expression exactly zero: (a - b) = k p, (c - d) = q, (e - f) = k q, (g - h) = p. */
function collinear(rnd: () => number, scale: number): number[] {
  const k = 1 + Math.floor(rnd() * 5), p = 1 + Math.floor(rnd() * 40), q = 1 + Math.floor(rnd() * 40);
  const base = () => Math.floor(rnd() * 1000) * scale;
  const [b, d, f, h] = [base(), base(), base(), base()];
  return [b + k * p * scale, b, d + q * scale, d, f + k * q * scale, f, h + p * scale, h];
}

describe('signOfDifference', () => {
  it('matches the exact reference on random inputs of every size', () => {
    const rnd = lcg(11);
    for (const [lo, hi] of [[-20, 20], [-600, 600], [-1074, -900], [900, 1023], [-40, 40]] as const) {
      for (let i = 0; i < 1500; i++) {
        const v = Array.from({ length: 8 }, () => randomDouble(rnd, lo, hi));
        // Differences of nearby values are the case that matters: pull some pairs close together.
        if (i % 3 === 0) { v[1] = v[0]! * (1 - 2 ** -30 * rnd()); v[5] = v[4]! * (1 + 2 ** -30 * rnd()); }
        if (!v.every(Number.isFinite)) continue;
        expect(sign(v), JSON.stringify(v)).toBe(reference(v));
        expect(signAbs(v), JSON.stringify(v)).toBe(reference(v, true));
      }
    }
  });

  it('gives exactly zero for collinear inputs at any scale', () => {
    const rnd = lcg(12);
    for (const scale of [1, 0.125, 2 ** -60, 2 ** 60, 2 ** -400, 2 ** 300, 3.7e-9, 1e12]) {
      for (let i = 0; i < 200; i++) {
        const v = collinear(rnd, scale);
        // The construction is exact only when no rounding happened; keep the cases where it is.
        if (reference(v) !== 0) continue;
        expect(sign(v), JSON.stringify(v)).toBe(0);
      }
    }
  });

  it('gets nearly collinear inputs right, where rounded arithmetic does not', () => {
    const rnd = lcg(13);
    let naiveWrong = 0, cases = 0;
    for (let i = 0; i < 4000; i++) {
      // A tiny step off a zero: one operand moved by one unit in the last place, in either direction.
      const v = collinear(rnd, 1 / 3 + rnd());
      const at = Math.floor(rnd() * 8);
      v[at] = i % 2 ? next(v[at]!) : -next(-v[at]!);
      expect(sign(v), JSON.stringify(v)).toBe(reference(v));
      cases++;
      if (naive(v) !== reference(v)) naiveWrong++;
    }
    expect(cases).toBe(4000);
    // The float answer alone is wrong often enough here that the exact fallback is what is being tested.
    expect(naiveWrong).toBeGreaterThan(10);
  });

  it('is right at huge magnitudes, where the products overflow to infinity', () => {
    const big = 1e300, v = [big, -big, big, 0, big, 0, big, -big];
    expect(naive(v)).toBeNaN();
    expect(sign(v)).toBe(reference(v));
    expect(sign([1.5e308, -1.5e308, 1.5e308, -1.5e308, 1.5e308, -1.4e308, 1.5e308, -1.5e308])).toBe(1);
    const rnd = lcg(14);
    for (let i = 0; i < 500; i++) {
      const w = Array.from({ length: 8 }, () => randomDouble(rnd, 900, 1020));
      expect(sign(w)).toBe(reference(w));
    }
  });

  it('is right at subnormal scale, where the products underflow to zero', () => {
    const tiny = 5e-324;
    // (3 tiny)(2 tiny) - (2 tiny)(2 tiny): both products round to zero in doubles, the exact difference is positive.
    const v = [3 * tiny, 0, 2 * tiny, 0, 2 * tiny, 0, 2 * tiny, 0];
    expect(naive(v)).toBe(0);
    expect(sign(v)).toBe(1);
    expect(sign([2 * tiny, 0, 2 * tiny, 0, 3 * tiny, 0, 2 * tiny, 0])).toBe(-1);
    expect(sign([2 * tiny, 0, 3 * tiny, 0, 3 * tiny, 0, 2 * tiny, 0])).toBe(0);
    const rnd = lcg(15);
    for (let i = 0; i < 2000; i++) {
      const w = Array.from({ length: 8 }, () => randomDouble(rnd, -1074, -520));
      expect(sign(w), JSON.stringify(w)).toBe(reference(w));
    }
  });

  it('accepts zero, negative zero and equal operands', () => {
    expect(sign([0, 0, 0, 0, 0, 0, 0, 0])).toBe(0);
    expect(sign([-0, 0, 5, 5, 0, -0, 1, 2])).toBe(0);
    expect(sign([1, 1, 7, -3, 4, 4, 8, 9])).toBe(0);
    expect(sign([3, 1, 3, 1, 2, 1, 2, 1])).toBe(1);
    expect(sign([2, 1, 1, 0, 4, 2, 3, 0])).toBe(-1);
  });

  it('refuses values that are not finite', () => {
    expect(() => sign([Infinity, 0, 1, 0, 1, 0, 1, 0])).toThrow(RangeError);
    expect(() => sign([0, 0, 1, 0, 1, 0, NaN, 0])).toThrow(RangeError);
    expect(() => signAbs([0, -Infinity, 1, 0, 1, 0, 1, 0])).toThrow(RangeError);
  });

  it('gives the same answer whether the float filter or the integer fallback decides', () => {
    // Inputs the filter accepts (large clear sign) must agree with the fallback, which only the reference path computes.
    const rnd = lcg(16);
    let clear = 0;
    for (let i = 0; i < 3000; i++) {
      const v = Array.from({ length: 8 }, () => randomDouble(rnd, -10, 10));
      const t1 = (v[0]! - v[1]!) * (v[2]! - v[3]!), t2 = (v[4]! - v[5]!) * (v[6]! - v[7]!);
      if (Math.abs(t1 - t2) > 1e-9 * (Math.abs(t1) + Math.abs(t2))) clear++;
      expect(sign(v)).toBe(reference(v));
    }
    expect(clear).toBeGreaterThan(2500);
  });

  it('counts the times the integer fallback decides', () => {
    const f0 = exactFallbacks();
    expect(signOfDifference(3, 1, 2, 0, 1, 0, 1, 0)).toBe(1); // 4 - 1: the filter decides
    expect(exactFallbacks()).toBe(f0);
    expect(signOfDifference(2, 0, 3, 0, 3, 0, 2, 0)).toBe(0); // 6 - 6: an exact tie needs the integers
    expect(exactFallbacks()).toBe(f0 + 1);
  });
});

describe('signOfAbsDifference', () => {
  it('compares magnitudes, whatever the signs of the differences', () => {
    expect(signAbs([1, 3, 1, 3, 0, 1, 0, 1])).toBe(1);   // |-2||-2| - |-1||-1|
    expect(signAbs([3, 1, 1, 3, 0, 1, 0, 1])).toBe(1);   // mixed signs give the same magnitudes
    expect(signAbs([1, 3, 3, 1, 5, 3, 1, 3])).toBe(0);
    expect(signAbs([0, 1, 0, 1, 1, 3, 3, 1])).toBe(-1);
  });

  it('is exact on collinear and nearly collinear inputs', () => {
    const rnd = lcg(17);
    for (let i = 0; i < 3000; i++) {
      const v = collinear(rnd, 1 / 3 + rnd());
      const at = Math.floor(rnd() * 8);
      if (i % 2) v[at] = next(v[at]!);
      expect(signAbs(v), JSON.stringify(v)).toBe(reference(v, true));
    }
  });
});
