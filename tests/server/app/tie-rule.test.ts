import { describe, expect, it } from 'vitest';
import { compareCandidates, decidingTieRule } from '../../../src/server/features/splitline/index.js';
import { tieRule } from '../../../src/server/app/rule-examples/cases/charts.js';

/** A small deterministic generator, so a failure reproduces. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

describe('decidingTieRule', () => {
  it('names the rule that compareCandidates decides a tie by, over many tied pairs', () => {
    const rnd = lcg(7);
    for (const angleCount of [2, 3, 10, 1800]) {
      const cmp = compareCandidates(angleCount);
      const decide = decidingTieRule(angleCount);
      for (let i = 0; i < 4000; i++) {
        // Small ranges make every rule, and full equality, come up often.
        const spread = i % 2 ? angleCount : Math.min(angleCount, 4);
        const a = { k: Math.floor(rnd() * (spread + 1)), lowSeats: Math.floor(rnd() * 3), lengthM: 1234.5 };
        const b = { k: Math.floor(rnd() * (spread + 1)), lowSeats: Math.floor(rnd() * 3), lengthM: 1234.5 };
        const sign = Math.sign(cmp(a, b));
        const { first, rule } = decide(a, b);
        if (sign === 0) {
          expect(rule, 'equal on every key').toBe(3);
        } else {
          expect(first === 'a' ? -1 : 1, `${JSON.stringify(a)} vs ${JSON.stringify(b)} at ${angleCount}`).toBe(sign);
        }
        // Swapping the pair swaps the winner, unless the two are identical on every key.
        if (sign !== 0) expect(decide(b, a).first).toBe(first === 'a' ? 'b' : 'a');
        expect(tieRule(a, b, angleCount)).toEqual({ first, rule });
      }
    }
  });

  it('reports the rule by its place in the order', () => {
    const decide = decidingTieRule(1800);
    expect(decide({ k: 187, lowSeats: 2 }, { k: 188, lowSeats: 2 }).rule).toBe(1);
    expect(decide({ k: 1799, lowSeats: 1 }, { k: 1, lowSeats: 1 }).rule).toBe(2);
    expect(decide({ k: 300, lowSeats: 3 }, { k: 300, lowSeats: 2 })).toEqual({ first: 'b', rule: 3 });
  });
});
