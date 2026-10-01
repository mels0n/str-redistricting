import { z } from 'zod';
import type { Block } from '../../entities/census-block/index.js';
import { DataError } from '../../shared/errors/index.js';
import type { LonLat } from '../../shared/geo/index.js';

const Props = z.object({
  GEOID20: z.string().regex(/^\d{15}$/),
  POP20: z.number().int().nonnegative(),
  INTPTLAT20: z.string().min(1),
  INTPTLON20: z.string().min(1),
});
const Position = z.tuple([z.number(), z.number()]).rest(z.number());
const Ring = z.array(Position).min(4);
const Geometry = z.discriminatedUnion('type', [
  z.object({ type: z.literal('Polygon'), coordinates: z.array(Ring) }),
  z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(Ring)) }),
]);

export function parseBlockFeature(props: unknown, geometry: unknown): Block {
  const p = Props.safeParse(props);
  if (!p.success) throw new DataError(`bad block record: ${p.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`);
  const g = Geometry.safeParse(geometry);
  if (!g.success) throw new DataError(`bad geometry for block ${p.data.GEOID20}`);
  const polys = g.data.type === 'Polygon' ? [g.data.coordinates] : g.data.coordinates;
  const rings = polys.flatMap((poly) => poly.map((ring) => ring.map((pt) => [pt[0], pt[1]] as LonLat)));
  const lat = Number.parseFloat(p.data.INTPTLAT20);
  const lon = Number.parseFloat(p.data.INTPTLON20);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new DataError(`bad internal point for block ${p.data.GEOID20}`);
  return { geoid: p.data.GEOID20, pop: p.data.POP20, point: [lon, lat], rings };
}
