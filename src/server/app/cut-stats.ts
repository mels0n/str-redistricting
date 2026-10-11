import type { SplitResult } from '../features/splitline/index.js';

type Cut = SplitResult['cuts'][number];

/** Per-cut summary of the search: one record of cut-stats.json. */
export function cutStats(c: Cut, i: number) {
  return {
    order: i + 1, depth: c.depth, seats: c.seats, firstDistrict: c.firstDistrict, angleDeg: c.angleDeg, fromDeg: c.fromDeg, toDeg: c.toDeg,
    lengthM: Math.round(c.lengthM), skipped: c.skipped, strayBlocksMoved: c.strayBlocksMoved, strayPopMoved: c.strayPopMoved,
    iterations: c.iterations, offsetShiftM: Math.round(c.offsetShiftM), candidateRanges: c.candidateRanges, reversedRanges: c.reversedRanges, tieSpans: c.tieSpans, reversed: c.reversed, tiedRanges: c.tiedRanges, tiedCuts: c.tiedCuts, splitChanges: c.splitChanges,
    tieSpanMs: Math.round(c.scan.tieSpanMs), derivedBuilds: c.scan.derivedBuilds, reconfigs: c.scan.reconfigs, exactFallbacks: c.scan.exactFallbacks,
  };
}
