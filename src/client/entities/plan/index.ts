// The plan entity: a state's published districts, their cuts, statistics and balancing replay, as the viewer
// reads them. Public API of the slice.

// Loading the published files of a state.
export { loadStateBundle, loadEnacted, loadStats } from './api';
export type { StateBundle, PlanShapes, DistrictFeature, EnactedShapes, WaterShapes } from './api';
// The cut sequence: pieces and sides after each step.
export { piecesAfter, pieceSizes, cutSides, cutRows, cutStep, stepBy, isLastStep } from './pieces';
export type { CutStep, CutRow } from './pieces';
// District colors, and finding the district at a point.
export { assignColors, unionNeighbors } from './coloring';
export { districtAt, districtsAt } from './locate';
// Border-block data.
export { BlocksSchema, districtsForBlock, loadBlocks } from './blocks';
export type { Blocks } from './blocks';
export type { PlanDistricts } from './locate';
// The even-split comparison.
export { evenSplit, evenSizes, evenSplitSentence, formatEvenPct, fromEven, describeFromEven } from './even';
export type { EvenSplit, FromEven } from './even';
// Schemas and types of the published files, and the water-bridge links.
export { StatsSchema, VersionStampSchema, CutsSchema, WaterTopoSchema, BridgesSchema } from './model';
export type { Stats, PlanStats, DistrictStats, Metrics, Cut, Bridges, BridgeLink } from './model';
export { linksIn, linksFeatures } from './bridges';
// The balancing log, and replay of its moves.
export { loadBalance, checkLog, BalanceSchema } from './balance';
export type { BalanceLog, MovedBlock } from './balance';
export {
  seqLength,
  seqIndex,
  seqFromIndex,
  seqStep,
  isSeqEnd,
  populationsAfter,
  rangeOf,
  moveDetail,
  movedBlocksAt,
  balancePlayInterval,
  balancePlanAt,
  isPartway,
  rangeTrace,
  isFastReplay,
  pageOf,
  pageAt,
} from './replay';
export type { BalanceMove, SeqPos, SeqSize, MoveDetail, ListPage } from './replay';
