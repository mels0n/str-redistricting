import { describe, expect, it } from 'vitest';
import { compareCutSides, cutSides, type CutSides } from '../../../src/server/features/splitline/index.js';

/** A small deterministic generator, so a failure reproduces. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

const sides = (blocks: number[], seats = 1, gap = 0): CutSides => ({ gap, side: Int32Array.from(blocks), seats });

describe('compareCutSides', () => {
  it('first uses the cut whose sides are nearer their fair shares of people, before any GEOID', () => {
    // [0, 2] would win on GEOID, but [0, 1] is nearer its share.
    expect(compareCutSides(sides([0, 1], 1, 4), sides([0, 2], 1, 6))).toBeLessThan(0);
    expect(compareCutSides(sides([0, 2], 1, 6), sides([0, 1], 1, 4))).toBeGreaterThan(0);
  });

  it('uses the cut whose list has the lower GEOID where the two lists first differ', () => {
    // Block indices are in GEOID order. Both lists start with the piece's lowest block, 0.
    expect(compareCutSides(sides([0, 1, 5]), sides([0, 2, 3]))).toBeLessThan(0);
    expect(compareCutSides(sides([0, 2, 3]), sides([0, 1, 5]))).toBeGreaterThan(0);
    // Later agreement does not matter once an earlier GEOID differs.
    expect(compareCutSides(sides([0, 1, 9]), sides([0, 2, 3, 4]))).toBeLessThan(0);
  });

  it('makes a list that ends first lose', () => {
    expect(compareCutSides(sides([0, 1]), sides([0, 1, 4]))).toBeGreaterThan(0);
    expect(compareCutSides(sides([0, 1, 4]), sides([0, 1]))).toBeLessThan(0);
  });

  it('treats equal lists as the same cut, and then prefers fewer seats on that side', () => {
    expect(compareCutSides(sides([0, 3], 2), sides([0, 3], 2))).toBe(0);
    expect(compareCutSides(sides([0, 3], 2), sides([0, 3], 3))).toBeLessThan(0);
    expect(compareCutSides(sides([0, 3], 3), sides([0, 3], 2))).toBeGreaterThan(0);
  });

  it('is antisymmetric and transitive over many random lists', () => {
    const rnd = lcg(7);
    const list = (): CutSides => {
      // Always holds block 0 (the piece's lowest GEOID), plus a random increasing set of small indices.
      const set = new Set<number>([0]);
      const n = Math.floor(rnd() * 5);
      for (let i = 0; i < n; i++) set.add(1 + Math.floor(rnd() * 6));
      return sides([...set].sort((a, b) => a - b), 1 + Math.floor(rnd() * 3));
    };
    let different = 0;
    for (let i = 0; i < 6000; i++) {
      const [a, b, c] = [list(), list(), list()];
      expect(Math.sign(compareCutSides(a, b)) + Math.sign(compareCutSides(b, a))).toBe(0);
      if (compareCutSides(a, b) !== 0) different++;
      if (compareCutSides(a, b) <= 0 && compareCutSides(b, c) <= 0) expect(compareCutSides(a, c)).toBeLessThanOrEqual(0);
    }
    expect(different).toBeGreaterThan(1000);
  });
});

describe('cutSides', () => {
  const lowSide = Int32Array.from([9, 4, 6]);
  const highSide = Int32Array.from([8, 2, 7]);

  it('takes the side holding the lowest block, whichever side is listed first, in block order', () => {
    const a = cutSides(lowSide, highSide, 2, 5, 0, 0);
    expect([...a.side]).toEqual([2, 7, 8]);
    expect(a.seats).toBe(3);
    // |first side's people x seats - piece people x first side's seats|: 30 people on 2 of 5 seats out of 100.
    expect(cutSides(lowSide, highSide, 2, 5, 30, 100).gap).toBe(50);
    const b = cutSides(highSide, lowSide, 3, 5, 0, 0);
    expect([...b.side]).toEqual([2, 7, 8]);
    expect(b.seats).toBe(3);
    const c = cutSides(Int32Array.from([1, 5]), Int32Array.from([3, 4]), 2, 5, 0, 0);
    expect([...c.side]).toEqual([1, 5]);
    expect(c.seats).toBe(2);
  });

  it('gives the same sides for the same two groups however they are named', () => {
    const rnd = lcg(11);
    for (let i = 0; i < 500; i++) {
      const all = Array.from({ length: 12 }, (_, k) => k).sort(() => rnd() - 0.5);
      const cut = 1 + Math.floor(rnd() * 11);
      const [x, y] = [all.slice(0, cut), all.slice(cut)];
      const seats = 2 + Math.floor(rnd() * 5);
      // One person per block, so the first side's people is its block count; the gap is the same from either side.
      const p = cutSides(Int32Array.from(x), Int32Array.from(y), 1, seats, x.length, 12);
      const q = cutSides(Int32Array.from(y), Int32Array.from(x), seats - 1, seats, y.length, 12);
      expect(compareCutSides(p, q)).toBe(0);
      expect(p.side[0]).toBe(0);
    }
  });

  it('does not change the lists it is given', () => {
    const low = Int32Array.from([3, 1]);
    cutSides(low, Int32Array.from([0, 2]), 1, 2, 0, 0);
    expect([...low]).toEqual([3, 1]);
  });
});
