/**
 * Two independent 32-bit fingerprints per block. A side's fingerprint is the XOR of its blocks', so it can be kept
 * up to date as blocks come and go; two sides with the same pair of fingerprints and the same length are treated as
 * the same result only for merging neighbouring ranges, and every chosen side is re-evaluated in full.
 */
export const zob = (i: number): number => {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
};
export const zob2 = (i: number): number => {
  let h = Math.imul(i ^ 0x7f4a7c15, 0x9e3779b1);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return h >>> 0;
};
