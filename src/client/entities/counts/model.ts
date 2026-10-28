import { z } from 'zod';

/** What /api/counts answers. Without a state only `national` and `waiting` come back. Ask counts sit under `${key}#asks`. */
export const DistrictCountsSchema = z.object({
  national: z.number().int().nonnegative(),
  state: z.number().int().nonnegative().default(0),
  waiting: z.number().int().nonnegative().default(0),
  byKey: z.record(z.string(), z.number().int().nonnegative()).default({}),
});
export type DistrictCounts = z.infer<typeof DistrictCountsSchema>;
