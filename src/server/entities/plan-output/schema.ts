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
  /** How the cut search chose among straight lines: 'exact' (every straight line, by the exact rotational sweep). */
  lineSearch: z.string(),
  nodeVersion: z.string(),
  inputSha256: z.string(),
  /** The engine version (config/versions.json) that drew the plan; absent from metrics written before it was recorded. */
  engine: z.string().optional(),
  seats: z.number().int().positive(),
  population: z.number(),
  ideal: z.number(),
  districts: z.array(District),
  rangePersons: z.number(),
  rangePct: z.number(),
  allContiguous: z.boolean(),
  assignmentSha256: z.string(),
  /** Island links the plan uses; absent from metrics written before links existed. */
  bridges: z.number().int().nonnegative().optional(),
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
  /** Drawn guide-line direction (middle of the winning range) and the winning range [fromDeg, toDeg), degrees from north-south. */
  angleDeg: z.number(),
  fromDeg: z.number(),
  toDeg: z.number(),
  lengthM: z.number(),
  /** Seats on the first side. cut-stats.json does not record it; the loader fills it in from cuts.geojson. */
  lowSeats: z.number().int().positive().optional(),
  /** The winning line is slid from the other end (absent in files made before it was recorded). */
  reversed: z.boolean().optional(),
}).passthrough();

/** out/<ST>/cut-stats.json: one record per cut, in cut order. */
export const CutStatsSchema = z.object({ cuts: z.array(CutStat) }).passthrough();
export type CutStats = z.infer<typeof CutStatsSchema>;

/** The part of out/<ST>/cuts.geojson that names each cut's first-side seat count. */
export const CutsGeoSchema = z.object({
  features: z.array(z.object({ properties: z.object({ order: z.number().int(), lowSeats: z.number().int().positive() }).passthrough() })),
});

/** out/<ST>/candidates.json: per cut, the leading candidates (ranges of directions) in the generator's order; `fields` names the columns. */
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
