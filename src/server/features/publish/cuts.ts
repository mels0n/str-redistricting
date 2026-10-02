import { z } from 'zod';

const Coord = z.tuple([z.number(), z.number()]);
const CutsGeo = z.object({
  features: z.array(z.object({
    properties: z.object({
      order: z.number().int().positive(),
      depth: z.number().int().nonnegative(),
      seats: z.number().int().min(2),
      lowSeats: z.number().int().positive(),
      highSeats: z.number().int().positive(),
      firstDistrict: z.number().int().nonnegative(),
      angleDeg: z.number(),
      lengthM: z.number(),
    }),
    geometry: z.object({ coordinates: z.array(z.array(Coord)) }),
  })),
});

export interface PublishedCut {
  readonly order: number;
  readonly depth: number;
  readonly seats: number;
  readonly lowSeats: number;
  readonly highSeats: number;
  readonly firstDistrict: number;
  readonly angleDeg: number;
  readonly lengthM: number;
  /** Guide-line spans, each a list of [lon, lat] points rounded to 5 decimals. */
  readonly lines: number[][][];
}

const r5 = (n: number): number => Math.round(n * 1e5) / 1e5;

/** The ordered cut list for the viewer, from the generator's cuts.geojson. */
export function buildCuts(raw: unknown): PublishedCut[] {
  return CutsGeo.parse(raw).features
    .map((f) => ({ ...f.properties, lines: f.geometry.coordinates.map((span) => span.map(([x, y]) => [r5(x), r5(y)])) }))
    .sort((a, b) => a.order - b.order);
}
