import { describe, expect, it } from 'vitest';
import { selectLow } from '../../../src/server/features/splitline/index.js';

/** Fixed-seed LCG (Numerical Recipes constants); no Math.random. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Sort-based reference for the documented rule. */
function reference(keys: Float64Array, ids: Int32Array, pops: Float64Array, target: number): { count: number; order: number[] } {
  const m = keys.length;
  const order = Array.from({ length: m }, (_, i) => i)
    .sort((a, b) => (keys[a]! - keys[b]!) || (ids[a]! - ids[b]!));
  let cum = 0;
  let count = m;
  for (let i = 0; i < m; i++) {
    const next = cum + pops[order[i]!]!;
    if (next >= target) {
      count = Math.abs(next - target) < Math.abs(cum - target) ? i + 1 : i;
      break;
    }
    cum = next;
  }
  return { count: Math.min(m - 1, Math.max(1, count)), order };
}

type KeyMode = 'random' | 'duplicates' | 'ties' | 'sorted';

function makeInput(rand: () => number, m: number, mode: KeyMode, zeroShare: number) {
  const keys = new Float64Array(m);
  const ids = new Int32Array(m);
  const pops = new Float64Array(m);
  // Distinct, shuffled ids so the id tie-break is exercised independently of position.
  const idList = Array.from({ length: m }, (_, i) => i * 3 + 1);
  for (let i = m - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idList[i], idList[j]] = [idList[j]!, idList[i]!];
  }
  for (let i = 0; i < m; i++) {
    ids[i] = idList[i]!;
    pops[i] = rand() < zeroShare ? 0 : Math.floor(rand() * 40);
    if (mode === 'random') keys[i] = rand();
    else if (mode === 'duplicates') keys[i] = Math.floor(rand() * Math.max(2, m / 8));
    else if (mode === 'ties') keys[i] = 7; // every key equal: order is purely by id
    else keys[i] = i * 0.5; // already sorted
  }
  return { keys, ids, pops };
}

describe('selectLow', () => {
  it('matches the sort-based reference on seeded pseudo-random inputs', () => {
    const rand = lcg(20201001);
    const modes: KeyMode[] = ['random', 'duplicates', 'ties', 'sorted'];
    const sizes = [2, 3, 4, 5, 15, 16, 17, 18, 33, 64, 100, 257, 1000, 2000];
    let cases = 0;
    for (const m of sizes) {
      for (const mode of modes) {
        for (const zeroShare of [0, 0.3, 0.9]) {
          const { keys, ids, pops } = makeInput(rand, m, mode, zeroShare);
          const total = pops.reduce((s, p) => s + p, 0);
          const seats = [2, 3, 5, 7][Math.floor(rand() * 4)]!;
          const lowSeats = 1 + Math.floor(rand() * (seats - 1));
          const targets = [
            (total * lowSeats) / seats,
            Math.floor(total / 2),            // exact tie candidates on even totals
            total / 2 + 0.5,
            0,
            total,
          ];
          for (const target of targets) {
            const perm = new Int32Array(m);
            const count = selectLow(keys, ids, pops, perm, target);
            const ref = reference(keys, ids, pops, target);
            expect(count, `m=${m} ${mode} target=${target}`).toBe(ref.count);
            const low = new Set(Array.from(perm.subarray(0, count)));
            const want = new Set(ref.order.slice(0, ref.count));
            expect(low.size).toBe(count);
            expect([...low].sort((a, b) => a - b)).toEqual([...want].sort((a, b) => a - b));
            cases++;
          }
        }
      }
    }
    expect(cases).toBeGreaterThan(600);
  });

  it('breaks an exact tie toward stopping before the crossing block', () => {
    const keys = Float64Array.from([0, 1, 2, 3]);
    const ids = Int32Array.from([0, 1, 2, 3]);
    const pops = Float64Array.from([1, 1, 2, 1]);
    // Target 2: after two blocks the total is exactly 2 (not a tie). Target 3: before = 2, after = 4, equal distance.
    expect(selectLow(keys, ids, pops, new Int32Array(4), 3)).toBe(2);
  });

  it('clamps to at least one block per side', () => {
    const keys = Float64Array.from([0, 1, 2]);
    const ids = Int32Array.from([0, 1, 2]);
    const pops = Float64Array.from([0, 0, 0]);
    expect(selectLow(keys, ids, pops, new Int32Array(3), 0)).toBe(1);
    expect(selectLow(keys, ids, pops, new Int32Array(3), 10)).toBe(2);
  });
});
