// The balancing pass: after the split-line rule, move border blocks between districts to even out population
// while keeping every district connected. Public API of the slice.

// The pass itself, with its result and the round-by-round observation types.
export { balance } from './balance.js';
export type { BalanceMove, BalanceOptions, BalanceResult, BalanceRound, MoveReason, RoundCandidate } from './balance.js';
// The published record of the moves made.
export { balanceLog, peopleMoved } from './log.js';
export type { BalanceLog } from './log.js';
