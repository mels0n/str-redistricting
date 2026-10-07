import { districtsAt, districtsForBlock, type Blocks, type PlanDistricts } from '../../entities/plan';
import type { LonLat } from '../../shared/lib/geo';

/** The exact district from the block assignment when the block resolves; otherwise the simplified-shape answer. */
export function lookupDistricts(input: {
  block: string | null;
  blocks: Blocks | null;
  shapes: Parameters<typeof districtsAt>[0];
  at: LonLat;
}): { districts: PlanDistricts; exact: boolean } {
  const exact = input.block !== null && input.blocks !== null ? districtsForBlock(input.blocks, input.block) : null;
  return exact ? { districts: exact, exact: true } : { districts: districtsAt(input.shapes, input.at), exact: false };
}

/**
 * Await the block file, then run `finish` (which locates, selects and navigates). If the page was destroyed in
 * the meantime nothing runs, so a late answer cannot navigate the visitor back. A failed load still finishes
 * with the simplified-shape answer.
 */
export async function finishWhenLoaded(
  load: Promise<Blocks | null>,
  opts: { alive: () => boolean; setBlocks: (b: Blocks | null) => void; finish: () => string; fallback: string },
): Promise<string> {
  const b = await load.catch(() => null);
  if (!opts.alive()) return opts.fallback;
  opts.setBlocks(b);
  return opts.finish();
}

/**
 * The district to select once the exact answer arrives, or null to leave the selection alone. `before` is the
 * district located from the simplified shapes when the page opened; the selection is replaced only if the visitor
 * has not changed it since (it is still `before`, or empty).
 */
export function exactSelection(input: { before: number | null; after: number | null; selected: number | null }): number | null {
  const { before, after, selected } = input;
  if (after === null || after === before) return null;
  return selected === before || selected === null ? after : null;
}
