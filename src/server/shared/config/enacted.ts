import { z } from 'zod';
import enactedJson from '../../../../config/enacted.json' with { type: 'json' };

/*
 * Which Congress's districts are shown for comparison, and which Census file they come from. The values live in
 * config/enacted.json, the one place the generator, the viewer and the scheduled update all read and write.
 */

/** Census cartographic boundary file name: cb_<year>_us_cd<congress>_500k. */
const FILE_PATTERN = /^cb_(\d{4})_us_cd(\d+)_500k$/;

/** "cb_2025_us_cd119_500k" -> { year: 2025, congress: 119 }; any other name -> null. */
export function parseEnactedFileName(file: string): { year: number; congress: number } | null {
  const m = FILE_PATTERN.exec(file);
  return m === null ? null : { year: Number(m[1]), congress: Number(m[2]) };
}

export const enactedFileName = (year: number, congress: number): string => `cb_${year}_us_cd${congress}_500k`;

export const EnactedConfigSchema = z
  .strictObject({
    congress: z.number().int().positive(),
    /** The file the published data is built from; always the first candidate. */
    file: z.string(),
    /** Vintages of that Congress, newest first; the first one the Census Bureau serves is the enacted source. */
    candidates: z.array(z.string()).min(1),
  })
  .superRefine((c, ctx) => {
    if (c.candidates[0] !== c.file) ctx.addIssue({ code: 'custom', message: 'file must be the first candidate' });
    for (const name of c.candidates) {
      if (parseEnactedFileName(name)?.congress !== c.congress) ctx.addIssue({ code: 'custom', message: `${name} is not a file of Congress ${c.congress}` });
    }
  });

export type EnactedConfig = z.infer<typeof EnactedConfigSchema>;

/** Validated once, at boot. */
export const ENACTED_CONFIG: EnactedConfig = EnactedConfigSchema.parse(enactedJson);
