import { z } from 'zod';

const CountySchema = z.object({ fips: z.string(), name: z.string() });

export const DistrictStatsSchema = z.object({
  district: z.number().int().positive(),
  pop: z.number().int().nonnegative(),
  dev: z.number(),
  devPct: z.number(),
  contiguous: z.boolean(),
  counties: z.array(CountySchema),
});

export const MetricsSchema = z.looseObject({
  state: z.string(),
  angleStepDeg: z.number().positive(),
  nodeVersion: z.string(),
  inputSha256: z.string().regex(/^[0-9a-f]{64}$/),
  seats: z.number().int().positive(),
  population: z.number().int().nonnegative(),
  ideal: z.number().positive(),
  rangePersons: z.number().nonnegative(),
  rangePct: z.number().nonnegative(),
  allContiguous: z.boolean(),
  assignmentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  balanceMoves: z.number().int().nonnegative(),
  peopleMovedByBalancing: z.number().int().nonnegative(),
  rangeBeforeBalancing: z.number().nonnegative(),
  rangeAfterBalancing: z.number().nonnegative(),
  cuts: z.number().int().nonnegative(),
  angleCount: z.number().int().positive(),
  candidateLinesEvaluated: z.number().int().nonnegative(),
  strayCapRejected: z.number().int().nonnegative(),
  strayBlocksMoved: z.number().int().nonnegative(),
  strayPopMoved: z.number().int().nonnegative(),
  runtimeMs: z.number().nonnegative(),
  countiesSplit: z.number().int().nonnegative(),
  countiesTotal: z.number().int().nonnegative(),
  blocks: z.number().int().nonnegative(),
});

const PlanStatsSchema = z.object({
  metrics: MetricsSchema,
  districts: z.array(DistrictStatsSchema).min(1),
});

/**
 * The published stats file. Its key for the finished map is `official` (the
 * generator's file format); the viewer calls that plan the finished map.
 */
export const StatsSchema = z
  .object({
    enactedSource: z.string(),
    official: PlanStatsSchema,
    beforeBalancing: PlanStatsSchema,
  })
  .transform(({ enactedSource, official, beforeBalancing }) => ({ enactedSource, finished: official, beforeBalancing }));

const LonLatSchema = z.tuple([z.number(), z.number()]);

export const CutSchema = z.object({
  order: z.number().int().positive(),
  depth: z.number().int().nonnegative(),
  seats: z.number().int().min(2),
  lowSeats: z.number().int().positive(),
  highSeats: z.number().int().positive(),
  firstDistrict: z.number().int().nonnegative(),
  angleDeg: z.number(),
  lengthM: z.number().nonnegative(),
  lines: z.array(z.array(LonLatSchema).min(2)),
});

export const CutsSchema = z.array(CutSchema);

export type DistrictStats = z.infer<typeof DistrictStatsSchema>;
export type Metrics = z.infer<typeof MetricsSchema>;
export type PlanStats = z.infer<typeof PlanStatsSchema>;
export type Stats = z.output<typeof StatsSchema>;
export type Cut = z.infer<typeof CutSchema>;

/** Topology objects as published: one GeometryCollection named `districts` or `enacted`. */
export const DistrictTopoSchema = z.looseObject({
  type: z.literal('Topology'),
  arcs: z.array(z.unknown()),
  objects: z.object({
    districts: z.looseObject({
      type: z.literal('GeometryCollection'),
      geometries: z.array(z.looseObject({ properties: z.object({ district: z.number().int().positive() }) })).min(1),
    }),
  }),
});

export const EnactedTopoSchema = z.looseObject({
  type: z.literal('Topology'),
  arcs: z.array(z.unknown()),
  objects: z.object({
    enacted: z.looseObject({
      type: z.literal('GeometryCollection'),
      geometries: z.array(z.looseObject({ properties: z.object({ label: z.string(), code: z.string() }) })),
    }),
  }),
});
