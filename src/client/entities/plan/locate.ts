import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { pointInGeometry, type LonLat } from '../../shared/lib/geo';

/** The district (1-based) whose shape contains the point, or null. */
export function districtAt(
  features: readonly Feature<Polygon | MultiPolygon, { district: number }>[],
  pt: LonLat,
): number | null {
  for (const f of features) if (pointInGeometry(pt, f.geometry)) return f.properties.district;
  return null;
}
