import { z } from 'zod';

const IndexSchema = z.object({
  states: z.array(
    z.object({
      abbr: z.string(),
      summary: z.object({ assignmentSha256: z.string().optional(), inputSha256: z.string().optional() }).optional(),
    }),
  ),
});

function hashesOf(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of IndexSchema.parse(JSON.parse(text)).states) out.set(s.abbr, `${s.summary?.assignmentSha256 ?? ''}|${s.summary?.inputSha256 ?? ''}`);
  return out;
}

/**
 * Did the published maps change between two copies of public/data/index.json? True when a state's assignment or input
 * hash differs, or a state was added or removed. No copy at the base means there is nothing to compare against.
 */
export function mapsDataChanged(baseIndex: string | null, headIndex: string | null): boolean {
  if (baseIndex === null) return false;
  if (headIndex === null) return true;
  const a = hashesOf(baseIndex);
  const b = hashesOf(headIndex);
  if (a.size !== b.size) return true;
  for (const [abbr, h] of a) if (b.get(abbr) !== h) return true;
  return false;
}
