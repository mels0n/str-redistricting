/**
 * A range that runs across north-south (from before 180 degrees on past 0) reports toDeg below fromDeg; one that
 * runs all the way round (every direction gives the same two sides) reports toDeg equal to fromDeg.
 */
export const crossesNorthSouth = (r: { fromDeg: number; toDeg: number }): boolean => r.toDeg <= r.fromDeg;
/** The range holds the north-south direction: it starts there, or runs across it. */
export const containsNorthSouth = (r: { fromDeg: number; toDeg: number }): boolean => r.fromDeg === 0 || crossesNorthSouth(r);
/** The middle of a range in [0, 180), measured on through 180 degrees for a range across north-south. */
export const middleDeg = (r: { fromDeg: number; toDeg: number }): number => {
  const m = (r.fromDeg + (crossesNorthSouth(r) ? r.toDeg + 180 : r.toDeg)) / 2;
  return m >= 180 ? m - 180 : m;
};
