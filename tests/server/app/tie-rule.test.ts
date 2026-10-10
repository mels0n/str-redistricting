import { describe, expect, it } from 'vitest';
import { compareCandidates, decidingTieRule } from '../../../src/server/features/splitline/index.js';
import type { Dir } from '../../../src/server/features/splitline/sweep.js';

/** A small deterministic generator, so a failure reproduces. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

/** The direction (dx, dy) from the origin: x east, y north, so (0, 1) is north-south and (1, 0) is east-west. */
const dir = (dx: number, dy: number): Dir => [0, 0, dx, dy];
const NS = dir(0, -1), D26 = dir(1, 2), D26M = dir(-1, 2), D45 = dir(1, 1), D135 = dir(-1, 1), D90 = dir(1, 0);
const range = (from: Dir, to: Dir, lowSeats = 1, lengthM = 1234.5) => ({ from, to, lowSeats, lengthM });

describe('decidingTieRule', () => {
  it('names the rule that compareCandidates decides a tie by, over many tied pairs', () => {
    const rnd = lcg(7);
    // Small integer vectors make every rule, and full equality, come up often.
    const pick = (): Dir => {
      for (;;) {
        const dx = Math.floor(rnd() * 7) - 3, dy = Math.floor(rnd() * 7) - 3;
        if (dx !== 0 || dy !== 0) return dir(dx, dy);
      }
    };
    const rule = { 1: 0, 2: 0, 3: 0 };
    for (let i = 0; i < 6000; i++) {
      const a = range(pick(), pick(), Math.floor(rnd() * 3));
      const b = range(i % 3 === 0 ? a.from : pick(), i % 5 === 0 ? a.to : pick(), Math.floor(rnd() * 3));
      const sign = Math.sign(compareCandidates(a, b));
      const { first, rule: r } = decidingTieRule(a, b);
      rule[r]++;
      if (sign === 0) {
        expect(r, 'equal on every key').toBe(3);
      } else {
        expect(first === 'a' ? -1 : 1, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`).toBe(sign);
        // Swapping the pair swaps the winner, unless the two are identical on every key.
        expect(decidingTieRule(b, a).first).toBe(first === 'a' ? 'b' : 'a');
      }
    }
    // The random pairs reach every rule.
    expect(rule[1]).toBeGreaterThan(100);
    expect(rule[2]).toBeGreaterThan(100);
    expect(rule[3]).toBeGreaterThan(100);
  });

  it('reports the rule by its place in the order', () => {
    // 1: nearer north-south. A range is as near as its nearer end.
    expect(decidingTieRule(range(D26, D45), range(D45, D90))).toEqual({ first: 'a', rule: 1 });
    expect(decidingTieRule(range(D90, D45), range(D45, D26))).toEqual({ first: 'b', rule: 1 });
    expect(decidingTieRule(range(NS, D90), range(D26, D45)).first).toBe('a');
    // 2: equally near (mirror images), so the earlier start in the half turn from north-south.
    expect(decidingTieRule(range(D26, D45), range(D135, D26M))).toEqual({ first: 'a', rule: 2 });
    expect(decidingTieRule(range(D135, D26M), range(D26, D45))).toEqual({ first: 'b', rule: 2 });
    // 3: the same range: fewer first-side seats.
    expect(decidingTieRule(range(D26, D45, 3), range(D26, D45, 2))).toEqual({ first: 'b', rule: 3 });
    // Identical on every key: the first one stays first.
    expect(decidingTieRule(range(D26, D45, 2), range(D26, D45, 2))).toEqual({ first: 'a', rule: 3 });
  });

  it('treats a direction and its opposite as the same line', () => {
    // (-1, -2) points the other way along the same line as (1, 2).
    expect(decidingTieRule(range(dir(-1, -2), D45), range(D26, D45))).toEqual({ first: 'a', rule: 3 });
  });
});

describe('compareCandidates', () => {
  it('orders by exact length, with no rounding unit, before any tie rule', () => {
    // The north-south range would win every tie rule; the other is 4 mm shorter, so it goes first.
    const ns = range(NS, D45, 1, 10.004);
    const leaning = range(D90, D135, 2, 10);
    expect(compareCandidates(leaning, ns)).toBeLessThan(0);
    expect(compareCandidates(ns, leaning)).toBeGreaterThan(0);
    // A difference far below a millimeter still decides.
    expect(compareCandidates({ ...leaning, lengthM: 10 + 1e-9 }, { ...ns, lengthM: 10 + 2e-9 })).toBeLessThan(0);
  });

  it('leaves exactly equal lengths to the tie rules', () => {
    const ns = range(NS, D26), east = range(D90, D135);
    expect(compareCandidates(ns, east)).toBeLessThan(0);
    expect(compareCandidates(east, ns)).toBeGreaterThan(0);
  });
});
