import type { SplitContext } from './context.js';
import { findCut, type CandidateRange, type CutOptions, type CutResult, type ScanCounters } from './cut.js';

export interface CutRecord {
  readonly depth: number;
  readonly seats: number;
  /** 0-based index of the first district this cut's range covers. */
  readonly firstDistrict: number;
  readonly lowSeats: number;
  readonly highSeats: number;
  /** The guide line's drawn direction (middle of the winning range) and the winning range itself, in degrees. */
  readonly angleDeg: number;
  readonly fromDeg: number;
  readonly toDeg: number;
  readonly lengthM: number;
  /** Candidates for this cut: ranges of directions with a distinct result, over both seat orientations. */
  readonly candidateRanges: number;
  /** The winning range runs across north-south; it is the line slid from the other end (see CutResult). */
  readonly wraps: boolean;
  readonly reversed: boolean;
  /** Ranges of lines slid from the other end that were swept for this cut (only where a stopping-rule tie was found). */
  readonly reversedRanges: number;
  readonly tieSpans: number;
  /** Ranges with the winning border length whose sides passed, and the distinct cuts among them (2 or more: GEOID decided). */
  readonly tiedRanges: number;
  readonly tiedCuts: number;
  /** Directions where some population split changed. */
  readonly splitChanges: number;
  readonly skipped: number;
  readonly strayBlocksMoved: number;
  readonly strayPopMoved: number;
  /** Population splits made for the chosen line: 1, plus one per re-count. */
  readonly iterations: number;
  readonly offsetShiftM: number;
  readonly candidates: readonly CandidateRange[];
  readonly spans: CutResult['spans'];
  /** What the cut's search did, for profiling only (see CutResult.scan). */
  readonly scan: ScanCounters;
}

export interface SplitResult {
  readonly assignment: Int32Array;
  readonly cuts: readonly CutRecord[];
}

export function splitState(ctx: SplitContext, seats: number, opts: CutOptions = {}): SplitResult {
  const assignment = new Int32Array(ctx.blocks.length).fill(-1);
  const cuts: CutRecord[] = [];
  const visit = (members: Int32Array, n: number, first: number, depth: number): void => {
    if (n === 1) { for (const i of members) assignment[i] = first; return; }
    const c = findCut(ctx, members, n, undefined, opts);
    cuts.push({ depth, seats: n, firstDistrict: first, lowSeats: c.lowSeats, highSeats: c.highSeats, angleDeg: c.angleDeg, fromDeg: c.fromDeg, toDeg: c.toDeg, wraps: c.wraps, reversed: c.reversed, reversedRanges: c.reversedRanges, tieSpans: c.tieSpans, lengthM: c.lengthM, candidateRanges: c.candidateRanges, tiedRanges: c.tiedRanges, tiedCuts: c.tiedCuts, splitChanges: c.splitChanges, skipped: c.skipped, strayBlocksMoved: c.strayBlocksMoved, strayPopMoved: c.strayPopMoved, iterations: c.iterations, offsetShiftM: c.offsetShiftM, candidates: c.candidates, spans: c.spans, scan: c.scan });
    visit(c.low, c.lowSeats, first, depth + 1);
    visit(c.high, c.highSeats, first + c.lowSeats, depth + 1);
  };
  visit(Int32Array.from({ length: ctx.blocks.length }, (_, i) => i), seats, 0, 0);
  return { assignment, cuts };
}
