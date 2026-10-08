import { z } from 'zod';

const District = z.object({
  district: z.number().int().positive(),
  pop: z.number(),
  dev: z.number(),
  devPct: z.number(),
  contiguous: z.boolean(),
});

/** The fields of a plan's metrics.json that readers rely on; any others pass through. */
export const PlanMetricsSchema = z.object({
  state: z.string(),
  angleStepDeg: z.number(),
  nodeVersion: z.string(),
  inputSha256: z.string(),
  seats: z.number().int().positive(),
  population: z.number(),
  ideal: z.number(),
  districts: z.array(District),
  rangePersons: z.number(),
  rangePct: z.number(),
  allContiguous: z.boolean(),
  assignmentSha256: z.string(),
}).passthrough();
export type PlanMetrics = z.infer<typeof PlanMetricsSchema>;

const Move = z.object({
  block: z.number().int().nonnegative(),
  geoid: z.string().regex(/^[0-9]{15}$/),
  from: z.number().int().positive(),
  to: z.number().int().positive(),
  pop: z.number().int().positive(),
  gain: z.number().positive(),
});

/** out/<ST>/balance.json as the generator writes it: districts 1-based, populations before the first move. */
export const BalanceLogSchema = z.object({ before: z.array(z.number().int().nonnegative()).min(1), moves: z.array(Move) });
export type BalanceLog = z.infer<typeof BalanceLogSchema>;

const CutStat = z.object({
  order: z.number().int(),
  depth: z.number().int(),
  seats: z.number().int(),
  /** 0-based index of the first district the piece becomes. */
  firstDistrict: z.number().int(),
  angleDeg: z.number(),
  lengthM: z.number(),
  /** Seats on the first side. cut-stats.json does not record it; the loader fills it in from cuts.geojson. */
  lowSeats: z.number().int().positive().optional(),
}).passthrough();

/** out/<ST>/cut-stats.json: one record per cut, in cut order. */
export const CutStatsSchema = z.object({ cuts: z.array(CutStat) }).passthrough();
export type CutStats = z.infer<typeof CutStatsSchema>;

/** The part of out/<ST>/cuts.geojson that names each cut's first-side seat count. */
export const CutsGeoSchema = z.object({
  features: z.array(z.object({ properties: z.object({ order: z.number().int(), lowSeats: z.number().int().positive() }).passthrough() })),
});

/** out/<ST>/candidates.json: per cut, one row per candidate line and side; `fields` names the columns. */
export const CandidatesSchema = z.object({
  fields: z.array(z.string()),
  cuts: z.array(z.array(z.array(z.number()))),
});
export type Candidates = z.infer<typeof CandidatesSchema>;

const Point = z.tuple([z.number(), z.number()]);

/** out/<ST>/bridges.json: each link the generator added to join detached land, with the two blocks and their internal points. */
export const BridgesOutSchema = z.object({
  links: z.array(z.object({
    a: z.string().regex(/^[0-9]{15}$/),
    b: z.string().regex(/^[0-9]{15}$/),
    aPoint: Point,
    bPoint: Point,
  })),
});
export type BridgesOut = z.infer<typeof BridgesOutSchema>;
