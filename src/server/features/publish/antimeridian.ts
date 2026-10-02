/**
 * States whose land lies on both sides of the 180th meridian. Alaska's western Aleutians have positive
 * longitudes while the rest of the state is negative, so a map frame that spans the state would span the world.
 */
const ACROSS_ANTIMERIDIAN: ReadonlySet<string> = new Set(['AK']);

export const crossesAntimeridian = (abbr: string): boolean => ACROSS_ANTIMERIDIAN.has(abbr);

/** Eastern-hemisphere longitudes continue past -180 (172 becomes -188) so the state is one continuous shape. */
export const unwrapLon = (lon: number): number => (lon > 0 ? lon - 360 : lon);

/** Deep copy of GeoJSON coordinates with every longitude unwrapped. Latitudes and altitudes are untouched. */
export function unwrapCoordinates(coords: unknown): unknown {
  if (!Array.isArray(coords)) return coords;
  if (typeof coords[0] === 'number') return [unwrapLon(coords[0]), ...coords.slice(1)];
  return coords.map(unwrapCoordinates);
}

interface WithGeometry {
  readonly geometry: unknown;
}

/** The same features with unwrapped geometry, for the display copies of a state that crosses the antimeridian. */
export function unwrapFeatures<T extends WithGeometry>(features: readonly T[]): T[] {
  return features.map((f) => {
    const g = f.geometry as { coordinates?: unknown } | null;
    return g?.coordinates === undefined ? f : { ...f, geometry: { ...g, coordinates: unwrapCoordinates(g.coordinates) } };
  });
}
