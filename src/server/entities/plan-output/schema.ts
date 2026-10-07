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
}).passthrough();

/** out/<ST>/cut-stats.json: one record per cut, in cut order. */
export const CutStatsSchema = z.object({ cuts: z.array(CutStat) }).passthrough();
export type CutStats = z.infer<typeof CutStatsSchema>;

/** out/<ST>/candidates.json: per cut, one row per candidate line and side; `fields` names the columns. */
export const CandidatesSchema = z.object({
  fields: z.array(z.string()),
  cuts: z.array(z.array(z.array(z.number()))),
});
export type Candidates = z.infer<typeof CandidatesSchema>;

const CutLine = z.object({
  type: z.literal('Feature'),
  properties: z.object({ order: z.number().int().positive() }).passthrough(),
  geometry: z.object({ type: z.literal('MultiLineString'), coordinates: z.array(z.array(z.tuple([z.number(), z.number()])).min(2)) }),
});

/** out/<ST>/cuts.geojson: each cut's guide line inside its piece, one feature per cut in cut order. */
export const CutLinesSchema = z.object({ type: z.literal('FeatureCollection'), features: z.array(CutLine) });
export type CutLines = z.infer<typeof CutLinesSchema>;
