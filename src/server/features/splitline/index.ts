// The split-line rule: divide a state into districts by repeatedly cutting a piece along the shortest straight
// (great-circle) line that splits its population in proportion to its seats. Public API of the slice.
// selectLow, ScanPool, PoolSlot and northSouthDistance are also exported for the rule-example and trace tooling.

// Projection context shared by every cut of a state.
export { createContext } from './context.js';
export type { SplitContext } from './context.js';
// One cut: candidate ordering and tie rules, and the cut search itself.
export { compareCandidates, decidingTieRule, findCut, northSouthDistance } from './cut.js';
export type { CandidateStat, CandidateTrace, CandidateTraceRequest, CutOptions, CutResult, SideValidator, TraceGroup, TracePass, TraceSweep } from './cut.js';
// Worker-thread scanning of candidate lines.
export { ScanPool } from './pool.js';
export { PoolSlot } from './pool-slot.js';
// The population-split quickselect, exposed for the rule examples.
export { selectLow } from './scan.js';
// The whole state: every cut, recursively.
export { splitState } from './split.js';
export type { CutRecord, SplitResult } from './split.js';
