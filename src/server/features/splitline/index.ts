// The split-line rule: divide a state into districts by repeatedly cutting a piece along the shortest straight
// (great-circle) line that splits its population in proportion to its seats, over every straight line (an exact
// rotational sweep). Public API of the slice. selectLow, ScanPool and PoolSlot are also exported for the
// rule-example and trace tooling.

// Projection context shared by every cut of a state.
export { createContext } from './context.js';
export type { SplitContext } from './context.js';
// One cut: the tie rules (people, then GEOID), and the cut search itself.
export { compareCutSides, compareGeoidSides, cutSides, findCut, traceLine } from './cut.js';
export type { CandidateRange, CandidateTrace, CandidateTraceRequest, CutOptions, CutResult, CutSides, SideValidator, TraceGroup, TracePass, TraceSweep } from './cut.js';
// Worker threads that sweep chunks of directions.
export { ScanPool } from './pool.js';
export { PoolSlot } from './pool-slot.js';
// The population-split quickselect, exposed for the rule examples.
export { selectLow } from './scan.js';
// The whole state: every cut, recursively.
export { splitState } from './split.js';
export type { CutRecord, SplitResult } from './split.js';
