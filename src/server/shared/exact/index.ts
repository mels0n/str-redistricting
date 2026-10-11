// Exact signs of small coordinate expressions: a float filter first, exact integer arithmetic when it cannot be sure.
// See the docs section "Why the result is exact and reproducible".
export { exactFallbacks, signOfAbsDifference, signOfDifference } from './exact.js';
