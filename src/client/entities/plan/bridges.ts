import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { Plan } from '../../shared';
import type { BridgeLink, Bridges } from './model';

/** The links of `plan` whose two ends are both in `district`; none when nothing is chosen or the state has no links. */
export function linksIn(bridges: Bridges | null, plan: Plan, district: number | null): BridgeLink[] {
  if (!bridges || district === null) return [];
  return bridges.links.filter((l) => l[plan][0] === district && l[plan][1] === district);
}

/** Lines (and their end points) for the map source. */
export function linksFeatures(links: readonly BridgeLink[]): { lines: FeatureCollection<LineString>; ends: FeatureCollection<Point> } {
  const lines: Feature<LineString>[] = links.map((l) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [l.a, l.b] } }));
  const ends: Feature<Point>[] = links.flatMap((l) => [l.a, l.b].map((c): Feature<Point> => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } })));
  return { lines: { type: 'FeatureCollection', features: lines }, ends: { type: 'FeatureCollection', features: ends } };
}
