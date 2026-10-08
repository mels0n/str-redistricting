import { z } from 'zod';

const IndexSchema = z.object({
  states: z.array(
    z.object({
      abbr: z.string(),
      summary: z
        .object({
          assignmentSha256: z.string().optional(),
          inputSha256: z.string().optional(),
          versions: z.object({ maps: z.number().int() }).optional(),
        })
        .optional(),
    }),
  ),
});

interface Entry {
  hashes: string;
  /** The Maps release the state's published stamp carries, if it has one. */
  maps: number | undefined;
}

function entriesOf(text: string): Map<string, Entry> {
  const out = new Map<string, Entry>();
  for (const s of IndexSchema.parse(JSON.parse(text)).states) {
    out.set(s.abbr, { hashes: `${s.summary?.assignmentSha256 ?? ''}|${s.summary?.inputSha256 ?? ''}`, maps: s.summary?.versions?.maps });
  }
  return out;
}

/**
 * The Maps release number before and after a change: `base` is what the base declared, `head` what the head declares.
 */
export interface DeclaredMaps {
  base: number;
  head: number;
}

/**
 * Did the published maps change between two copies of public/data/index.json, in a way the Maps release does not
 * already cover? True when a state's assignment or input hash differs, or a state was added or removed. No copy at
 * the base means there is nothing to compare against.
 *
 * With `declared`, a change is covered (and does not count) when the Maps release was not bumped in this change
 * (`base === head`, so an earlier change already declared it) and every state whose hashes changed carries that same
 * release in the head's stamp: the data is for the release that is already declared. A removed state, a state with no
 * stamp and a state stamped with any other release are never covered.
 */
export function mapsDataChanged(baseIndex: string | null, headIndex: string | null, declared?: DeclaredMaps): boolean {
  if (baseIndex === null) return false;
  if (headIndex === null) return true;
  const a = entriesOf(baseIndex);
  const b = entriesOf(headIndex);
  const changed = [...new Set([...a.keys(), ...b.keys()])].filter((abbr) => a.get(abbr)?.hashes !== b.get(abbr)?.hashes);
  if (changed.length === 0) return false;
  if (declared === undefined || declared.base !== declared.head) return true;
  return changed.some((abbr) => b.get(abbr)?.maps !== declared.head);
}
