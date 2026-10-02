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
  official: number | null;
  before: number | null;
}

/** The point's district under the official map and under the map before balancing; they can differ near a border. */
export function districtsAt(
  plans: {
    official: { features: readonly Feature<Polygon | MultiPolygon, { district: number }>[] };
    before: { features: readonly Feature<Polygon | MultiPolygon, { district: number }>[] };
  },
  pt: LonLat,
): PlanDistricts {
  return { official: districtAt(plans.official.features, pt), before: districtAt(plans.before.features, pt) };
}
