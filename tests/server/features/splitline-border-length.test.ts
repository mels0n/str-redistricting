import { describe, expect, it } from 'vitest';
import { borderLength } from '../../../src/server/features/splitline/scan.js';

describe('borderLength', () => {
  // Three pairs whose total depends on the order they are added: 2^53 + 1 rounds back to 2^53, but 1 + 1 + 2^53 does not.
  const a = Int32Array.from([0, 0, 1]);
  const b = Int32Array.from([1, 2, 2]);
  const len = Float64Array.from([1, 2 ** 53, 1]);
  const inBlockOrder = (1 + 2 ** 53) + 1;

  it('adds the pairs in block order, whatever order they were found in', () => {
    for (const found of [[0, 1, 2], [0, 2, 1], [2, 0, 1], [2, 1, 0], [1, 0, 2], [1, 2, 0]]) {
      expect(borderLength(Int32Array.from(found), a, b, len)).toBe(inBlockOrder);
    }
    // The order matters: adding the two short pairs first gives a different number.
    expect((1 + 1) + 2 ** 53).not.toBe(inBlockOrder);
  });

  it('orders by the lower position, then the higher one', () => {
    const a2 = Int32Array.from([1, 0, 0]);
    const b2 = Int32Array.from([2, 2, 1]);
    const len2 = Float64Array.from([1, 2 ** 53, 1]);
    // Block order is (0,1), (0,2), (1,2): lengths 1, 2^53, 1.
    expect(borderLength(Int32Array.from([0, 1, 2]), a2, b2, len2)).toBe(inBlockOrder);
  });

  it('is zero for an empty border', () => {
    expect(borderLength(new Int32Array(0), a, b, len)).toBe(0);
  });
});
