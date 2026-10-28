// The reps entity: who holds each seat of a state, as published in reps/<ST>.json. Public API of the slice.
export { loadStateReps } from './api';
export { RepSchema, StateRepsSchema, STATEWIDE_CODE } from './model';
export type { Rep, StateReps } from './model';
