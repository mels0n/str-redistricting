import { z } from 'zod';
import { engineMajor } from '../../shared/config/index.js';

const IndexSchema = z.object({
  states: z.array(
    z.object({
      abbr: z.string(),
      summary: z
        .object({
          assignmentSha256: z.string().optional(),
          beforeAssignmentSha256: z.string().optional(),
          inputSha256: z.string().optional(),
          versions: z
            .object({ maps: z.number().int(), engine: z.string().optional(), input: z.object({ vintage: z.string() }).optional() })
            .optional(),
        })
        .optional(),
    }),
  ),
});

interface Entry {
  hashes: string;
  /** The before-balancing fingerprint; undefined when the index does not record it (older indexes). */
  before: string | undefined;
  /** The Maps release the state's published stamp carries, if it has one. */
  maps: number | undefined;
  /**
   * Engine major, input vintage and the state's census file hash: what the publish gate keys a map on. The input
   * revision is left out on purpose: an enacted-only revision moves it without being able to change an assignment.
   */
  drawnBy: string | undefined;
}

function entriesOf(text: string): Map<string, Entry> {
  const out = new Map<string, Entry>();
  for (const s of IndexSchema.parse(JSON.parse(text)).states) {
    const v = s.summary?.versions;
    const census = s.summary?.inputSha256;
    const drawnBy = v?.engine === undefined || v.input === undefined || census === undefined ? undefined : `${engineMajor(v.engine)}|${v.input.vintage}|${census}`;
    out.set(s.abbr, { hashes: `${s.summary?.assignmentSha256 ?? ''}|${census ?? ''}`, before: s.summary?.beforeAssignmentSha256, maps: v?.maps, drawnBy });
  }
  return out;
}

/** The fingerprints differ. The before-balancing one counts only when both sides record it, so adding the field is not a change. */
const differs = (a: Entry | undefined, b: Entry | undefined): boolean =>
  a?.hashes !== b?.hashes || (a?.before !== undefined && b?.before !== undefined && a.before !== b.before);

/**
 * The Maps release number before and after a change: `base` is what the base declared, `head` what the head declares.
 */
export interface DeclaredMaps {
  base: number;
  head: number;
}

/**
 * Did the published maps change between two copies of public/data/index.json, in a way the Maps release does not
 * already cover? True when a state's assignment (finished or before-balancing) or input hash differs, or a state was
 * added or removed. No copy at the base means there is nothing to compare against.
 *
 * With `declared`, a change is covered (and does not count) when the Maps release was not bumped in this change
 * (`base === head`, so an earlier change already declared it) and every state whose hashes changed carries that same
 * release in the head's stamp: the data is for the release that is already declared. A removed state, a state with no
 * stamp and a state stamped with any other release are never covered. Neither is a state drawn under the same engine
 * major, input vintage and census file hash as at the base: those give the same map every time, so its hashes cannot
 * legitimately change (a new input revision from the enacted districts alone does not reopen this).
 */
export function mapsDataChanged(baseIndex: string | null, headIndex: string | null, declared?: DeclaredMaps): boolean {
  if (baseIndex === null) return false;
  if (headIndex === null) return true;
  const a = entriesOf(baseIndex);
  const b = entriesOf(headIndex);
  const changed = [...new Set([...a.keys(), ...b.keys()])].filter((abbr) => differs(a.get(abbr), b.get(abbr)));
  if (changed.length === 0) return false;
  if (declared === undefined || declared.base !== declared.head) return true;
  return changed.some((abbr) => {
    const head = b.get(abbr);
    const base = a.get(abbr);
    if (head === undefined || head.maps !== declared.head || head.drawnBy === undefined) return true;
    return base !== undefined && base.drawnBy === head.drawnBy;
  });
}
