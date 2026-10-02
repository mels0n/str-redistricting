import { describe, expect, it } from 'vitest';
import { asin, atan, atan2, cos, hypot2, sin } from '../../../src/server/shared/detmath/index.js';
import { asinRef, atan2Ref, atanRef, cosRef, roundToDouble, sinRef, toFixed, ulpError } from '../../helpers/bigref.js';

const view = new DataView(new ArrayBuffer(8));
const bits = (x: number): string => {
  view.setFloat64(0, x);
  return view.getBigUint64(0).toString(16).padStart(16, '0');
};
const fromBits = (h: string): number => {
  view.setBigUint64(0, BigInt(`0x${h}`));
  return view.getFloat64(0);
};

/** Distance in ulps between two finite doubles of any sign. */
function ulpDiff(a: number, b: number): number {
  if (a === b) return 0;
  const ord = (x: number): bigint => {
    view.setFloat64(0, x);
    const i = view.getBigInt64(0);
    return i < 0n ? -(i & 0x7fffffffffffffffn) : i;
  };
  const d = ord(a) - ord(b);
  return Number(d < 0n ? -d : d);
}

/** Deterministic uniform samples in [lo, hi). */
function samples(n: number, lo: number, hi: number, seed = 12345): number[] {
  let s = seed >>> 0;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out.push(lo + ((hi - lo) * s) / 4294967296);
  }
  return out;
}

const RAD = Math.PI / 180;
const tiny = (x: number) => x === 0 || Math.abs(x) < 2 ** -1000;

describe('detmath accuracy against a 320-bit reference', () => {
  /** Worst error against the exact value (in ulps) and worst distance from the correctly rounded double. */
  const measure = (name: string, cases: [number, number, bigint][]) => {
    let worst = 0, worstFromRounded = 0, at = 0;
    for (const [x, d, ref] of cases) {
      if (tiny(d)) continue;
      const e = ulpError(d, ref);
      if (e > worst) { worst = e; at = x; }
      worstFromRounded = Math.max(worstFromRounded, ulpDiff(d, roundToDouble(ref)));
    }
    console.log(`${name}: max error ${worst.toFixed(4)} ulp (at ${at}), max ${worstFromRounded} ulp from the correctly rounded value, ${cases.length} inputs`);
    expect(worstFromRounded).toBeLessThanOrEqual(1);
    return worst;
  };
  const check = (name: string, xs: number[], f: (x: number) => number, ref: (x: bigint) => bigint) =>
    measure(name, xs.map((x) => [x, f(x), ref(toFixed(x))]));
  const trigInputs = [
    ...samples(3000, -2 * Math.PI, 2 * Math.PI),
    ...samples(300, -1e5, 1e5, 7),
    ...samples(200, 1e-9, 1e-3, 9),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 100, 1000].flatMap((k) => [k * Math.PI / 2, k * Math.PI / 2 + 1e-12, k * Math.PI / 2 - 1e-12]),
    ...Array.from({ length: 1800 }, (_, k) => (k * 180 * RAD) / 1800),
  ];
  it('sin is within 1 ulp', () => expect(check('sin', trigInputs, sin, sinRef)).toBeLessThan(1));
  it('cos is within 1 ulp', () => expect(check('cos', trigInputs, cos, cosRef)).toBeLessThan(1));
  it('atan is within 1 ulp', () =>
    expect(check('atan', [...samples(2000, -2, 2), ...samples(1000, -60, 60, 3), ...samples(200, -1e20, 1e20, 5), 0.4375, 0.6875, 1.1875, 2.4375], atan, atanRef)).toBeLessThan(1));
  it('asin is within 1 ulp', () =>
    expect(check('asin', [...samples(3000, -1, 1), ...samples(300, 0.97, 1, 11), ...samples(300, -0.5, 0.5, 13), 0.5, -0.5, 0.975, 1, -1], asin, asinRef)).toBeLessThan(1));
  it('atan2 is within 1 ulp of the correctly rounded value', () => {
    // The rounding of y/x adds up to half an ulp, so atan2 can sit just over 1 ulp from the exact value.
    const ys = samples(2000, -2, 2, 17), xs = samples(2000, -2, 2, 19);
    expect(measure('atan2', ys.map((y, i) => [y, atan2(y, xs[i]!), atan2Ref(toFixed(y), toFixed(xs[i]!))]))).toBeLessThan(1.5);
  });
});

describe('detmath against this engine', () => {
  // Informational on the engine running the tests: an engine may approximate these, so allow 1 ulp.
  const sweep = (name: string, n: number, lo: number, hi: number, f: (x: number) => number, g: (x: number) => number) => {
    let worst = 0, differ = 0;
    for (let i = 0; i <= n; i++) {
      const x = lo + ((hi - lo) * i) / n;
      const d = ulpDiff(f(x), g(x));
      if (d > 0) differ++;
      if (d > worst) worst = d;
    }
    console.log(`${name} on [${lo}, ${hi}]: max ${worst} ulp from the engine, ${differ} of ${n + 1} differ`);
    expect(worst).toBeLessThanOrEqual(1);
  };
  it('sin and cos over guide-line angles, latitudes and longitudes', () => {
    sweep('sin', 200_000, 0, Math.PI, sin, Math.sin);
    sweep('cos', 200_000, 0, Math.PI, cos, Math.cos);
    sweep('sin', 200_000, -3.2, 3.2, sin, Math.sin);
    sweep('cos', 200_000, -3.2, 3.2, cos, Math.cos);
    sweep('sin', 200_000, -0.05, 0.05, sin, Math.sin);
  });
  it('atan over gnomonic radii', () => sweep('atan', 200_000, 0, 2, atan, Math.atan));
  it('asin over its whole domain', () => sweep('asin', 200_000, -1, 1, asin, Math.asin));
  it('atan2 over the unit square', () => {
    let worst = 0;
    for (let i = -300; i <= 300; i++) for (let j = -300; j <= 300; j++) {
      const y = i / 300 + 1e-7, x = j / 300 - 3e-7;
      worst = Math.max(worst, ulpDiff(atan2(y, x), Math.atan2(y, x)));
    }
    console.log(`atan2 on the unit square: max ${worst} ulp from the engine`);
    expect(worst).toBeLessThanOrEqual(1);
  });
});

describe('detmath special values', () => {
  it('handles zeros, ones, infinities and NaN like the IEEE functions', () => {
    expect(Object.is(sin(-0), -0)).toBe(true);
    expect(cos(0)).toBe(1);
    expect(sin(Infinity)).toBeNaN();
    expect(cos(NaN)).toBeNaN();
    expect(atan(Infinity)).toBe(Math.PI / 2);
    expect(atan(-Infinity)).toBe(-Math.PI / 2);
    expect(asin(1)).toBe(Math.PI / 2);
    expect(asin(-1)).toBe(-Math.PI / 2);
    expect(asin(1.0000001)).toBeNaN();
    expect(atan2(0, -1)).toBe(Math.PI);
    expect(atan2(-0, -1)).toBe(-Math.PI);
    expect(Object.is(atan2(-0, 1), -0)).toBe(true);
    expect(atan2(1, 0)).toBe(Math.PI / 2);
    expect(atan2(-1, 0)).toBe(-Math.PI / 2);
    expect(atan2(1, -Infinity)).toBe(Math.PI);
    expect(atan2(NaN, 1)).toBeNaN();
  });
  it('rejects trig arguments beyond 2^19 * pi/2 rather than reduce them inaccurately', () => {
    expect(() => sin(1e7)).toThrow(RangeError);
  });
  it('hypot2 is sqrt(x*x + y*y)', () => {
    expect(hypot2(3, 4)).toBe(5);
    expect(hypot2(-0.3, 0.4)).toBe(Math.sqrt(0.09 + 0.16000000000000003));
  });
});

/**
 * Exact outputs, as IEEE 754 bit patterns, for inputs spread over the generator's ranges. Any engine
 * that runs these tests checks it reproduces the generator's arithmetic bit for bit.
 */
const GOLDEN: Record<'sin' | 'cos' | 'atan' | 'asin', [string, string][]> = {
  sin: [
    ['3ddb7cdfd9d7bdbb', '3ddb7cdfd9d7bdbb'],
    ['3f50624dd2f1a9fc', '3f50624da5218a62'],
    ['3fb08821562604a2', '3fb08530797b5a39'],
    ['3fe921fb54442d18', '3fe6a09e667f3bcc'],
    ['3ff921fb54442d18', '3ff0000000000000'],
    ['40091e684623b62c', '3f5c98701025eb5f'],
    ['3fe5c81e15d4af9d', '3fe4236484487abd'],
    ['bffd760e6f942f2c', 'bfeed60f883ebe01'],
    ['3fdcd1a1e5bed0b9', '3fdbdad38a8066c6'],
    ['3feb5de4288e80bf', '3fe82694b4a11c37'],
    ['bf8930be0ded288d', 'bf8930946d85ec23'],
    ['3f164840e1719f80', '3f164840e0fe61ec'],
    ['3ff921fb54442d18', '3ff0000000000000'],
    ['400921fb54442d18', '3ca1a62633145c07'],
    ['4004000000000000', '3fe326af0dcfcab0'],
    ['c007333333333333', 'bfce9fb8d64830e3'],
  ],
  cos: [
    ['3ddb7cdfd9d7bdbb', '3ff0000000000000'],
    ['3f50624dd2f1a9fc', '3feffffef390876c'],
    ['3fb08821562604a2', '3fefeeecbc14b12f'],
    ['3fe921fb54442d18', '3fe6a09e667f3bcd'],
    ['3ff921fb54442d18', '3c91a62633145c07'],
    ['40091e684623b62c', 'bfeffffcce4c8e64'],
    ['3fe5c81e15d4af9d', '3fe8de613515a328'],
    ['bffd760e6f942f2c', 'bfd11a6efd5f8138'],
    ['3fdcd1a1e5bed0b9', '3feccf694fe4b6db'],
    ['3feb5de4288e80bf', '3fe4fe6f81384fd4'],
    ['bf8930be0ded288d', '3fefff615ce9704f'],
    ['3f164840e1719f80', '3feffffffe0f8075'],
    ['3ff921fb54442d18', '3c91a62633145c07'],
    ['400921fb54442d18', 'bff0000000000000'],
    ['4004000000000000', 'bfe9a2f7ef858b7d'],
    ['c007333333333333', 'bfef1216dba340c9'],
  ],
  atan: [
    ['3d719799812dea11', '3d719799812dea11'],
    ['3f1a36e2eb1c432d', '3f1a36e2e9a4f662'],
    ['3fa999999999999a', '3fa9942597929f27'],
    ['3fbf9adbb8f8da72', '3fbf721fd882bd5e'],
    ['3fc999999999999a', '3fc94441f8f7260c'],
    ['3fdc000000000000', '3fda64eec3cc23fd'],
    ['3fe0000000000000', '3fddac670561bb4f'],
    ['3fe6666666666666', '3fe38b112d7bd4ad'],
    ['3ff0000000000000', '3fe921fb54442d18'],
    ['3ff8000000000000', '3fef730bd281f69b'],
    ['4003800000000000', '3ff2e75728833a54'],
    ['401d333333333333', '3ff6f45b483af72d'],
    ['bfd3333333333333', 'bfd2a73a661eaf06'],
  ],
  asin: [
    ['3e112e0be826d695', '3e112e0be826d695'],
    ['3fb999999999999a', '3fb9a49276037884'],
    ['bfd3333333333333', 'bfd380159e14f6ff'],
    ['3fe0000000000000', '3fe0c152382d7366'],
    ['3fe4236484487abd', '3fe5c81e15d4af9d'],
    ['3fe999999999999a', '3fedac670561bb50'],
    ['3fef333333333333', '3ff58c2b5ce0c3e5'],
    ['3fef5c28f5c28f5c', '3ff5ed690583be07'],
    ['3fefffffca501acb', '3ff920266447a7fa'],
    ['bfe6666666666666', 'bfe8d00e692afd95'],
    ['3ff0000000000000', '3ff921fb54442d18'],
  ],
};
const GOLDEN_ATAN2: [string, string, string][] = [
  ['3fd3333333333333', '3fd999999999999a', '3fe4978fa3269ee0'],
  ['bfd3333333333333', '3fd999999999999a', 'bfe4978fa3269ee0'],
  ['3fd3333333333333', 'bfd999999999999a', '4003fc176b7a8560'],
  ['bfd3333333333333', 'bfd999999999999a', 'c003fc176b7a8560'],
  ['3eb0c6f7a0b5ed8d', '3f613404ea4a8c15', '3f3f35265e085b7c'],
  ['3f847ae147ae147b', 'be8ad7f29abcaf48', '3ff922104cf9b5f0'],
  ['bfa999999999999a', '3faa1cac083126e9', 'bfe8d0e0205da5d7'],
  ['4000000000000000', '3f50624dd2f1a9fc', '3ff91fef0a8cabe5'],
];

describe('detmath golden values', () => {
  const fns = { sin, cos, atan, asin };
  it('pins every function to the same bits on every engine', () => {
    for (const [name, rows] of Object.entries(GOLDEN) as [keyof typeof fns, [string, string][]][]) {
      expect(rows.length).toBeGreaterThan(0);
      for (const [x, y] of rows) expect(`${name}(${x}) = ${bits(fns[name](fromBits(x)))}`).toBe(`${name}(${x}) = ${y}`);
    }
    expect(GOLDEN_ATAN2.length).toBeGreaterThan(0);
    for (const [y, x, r] of GOLDEN_ATAN2) expect(`atan2(${y}, ${x}) = ${bits(atan2(fromBits(y), fromBits(x)))}`).toBe(`atan2(${y}, ${x}) = ${r}`);
  });
});
