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

/** The district a point falls in under each plan, by plan name. */
export interface PlanDistricts {
  finished: number | null;
  before: number | null;
}

/** The point's district under the finished map and under the map before balancing; they can differ near a border. */
export function districtsAt(
  plans: {
    finished: { features: readonly Feature<Polygon | MultiPolygon, { district: number }>[] };
    before: { features: readonly Feature<Polygon | MultiPolygon, { district: number }>[] };
  },
  pt: LonLat,
): PlanDistricts {
  return { finished: districtAt(plans.finished.features, pt), before: districtAt(plans.before.features, pt) };
}
