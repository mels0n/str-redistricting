import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { DataError } from '../errors/index.js';

/*
 * How many districts each state legislative chamber has: the number of distinct districts in the pinned Census files,
 * generated into config/legislative-districts.json. Read on first use, so a run that draws only the Federal House
 * never opens it.
 */

const Count = z.number().int().min(0);

export const LegislativeDistrictsSchema = z.strictObject({
  vintage: z.number().int().positive(),
  states: z.record(z.string().regex(/^[A-Z]{2}$/), z.strictObject({ 'state-house': Count, 'state-senate': Count })),
});
export type LegislativeDistricts = z.infer<typeof LegislativeDistrictsSchema>;

const FILE = new URL('../../../../config/legislative-districts.json', import.meta.url);

let cached: LegislativeDistricts | undefined;

/** The counts file, validated; a missing or malformed file is a DataError naming the command that writes it. */
export function legislativeDistricts(): LegislativeDistricts {
  if (cached !== undefined) return cached;
  try {
    cached = LegislativeDistrictsSchema.parse(JSON.parse(readFileSync(FILE, 'utf8')));
  } catch {
    throw new DataError('config/legislative-districts.json is missing or invalid; run `npm run legislative:count`');
  }
  return cached;
}
