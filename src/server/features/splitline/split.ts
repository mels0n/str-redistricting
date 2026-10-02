import type { SplitContext } from './context.js';
import { findCut, type CutResult } from './cut.js';

export interface CutRecord {
  readonly depth: number;
  readonly seats: number;
  /** 0-based index of the first district this cut's range covers. */
  readonly firstDistrict: number;
  readonly lowSeats: number;
  readonly highSeats: number;
  readonly angleDeg: number;
  readonly lengthM: number;
  readonly skipped: number;
  readonly strayCapRejected: number;
  readonly strayBlocksMoved: number;
  readonly strayPopMoved: number;
  readonly spans: CutResult['spans'];
}

export interface SplitResult {
  readonly assignment: Int32Array;
  readonly cuts: readonly CutRecord[];
}

export function splitState(ctx: SplitContext, seats: number): SplitResult {
  const assignment = new Int32Array(ctx.blocks.length).fill(-1);
  const cuts: CutRecord[] = [];
  const visit = (members: Int32Array, n: number, first: number, depth: number): void => {
    if (n === 1) { for (const i of members) assignment[i] = first; return; }
    const c = findCut(ctx, members, n);
    cuts.push({ depth, seats: n, firstDistrict: first, lowSeats: c.lowSeats, highSeats: c.highSeats, angleDeg: c.angleDeg, lengthM: c.lengthM, skipped: c.skipped, strayCapRejected: c.strayCapRejected, strayBlocksMoved: c.strayBlocksMoved, strayPopMoved: c.strayPopMoved, spans: c.spans });
    visit(c.low, c.lowSeats, first, depth + 1);
    visit(c.high, c.highSeats, first + c.lowSeats, depth + 1);
  };
  visit(Int32Array.from({ length: ctx.blocks.length }, (_, i) => i), seats, 0, 0);
  return { assignment, cuts };
}
