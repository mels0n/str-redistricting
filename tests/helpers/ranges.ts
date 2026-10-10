/** A range, as findCut reports it: `wraps` when it runs across north-south (from before 180 degrees on past 0). */
type R = { readonly fromDeg: number; readonly toDeg: number; readonly wraps: boolean };
export const crossesNorthSouth = (r: R): boolean => r.wraps;
/** The range holds the north-south direction: it starts there, or runs across it. */
export const containsNorthSouth = (r: R): boolean => r.fromDeg === 0 || r.wraps;
/** The middle of a range in [0, 180), measured on through 180 degrees for a range across north-south. */
export const middleDeg = (r: R): number => {
  const m = (r.fromDeg + (r.wraps ? r.toDeg + 180 : r.toDeg)) / 2;
  return m >= 180 ? m - 180 : m;
};
