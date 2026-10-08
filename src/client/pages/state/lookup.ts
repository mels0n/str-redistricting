import { districtsAt, districtsForBlock, type Blocks, type PlanDistricts } from '../../entities/plan';
import type { LonLat } from '../../shared/lib/geo';

/**
 * The exact district from the block assignment when the block resolves; otherwise the simplified-shape answer.
 * Blocks built from a different plan than the one drawn (their fingerprints differ from the drawn bundle's) are unusable.
 */
export function lookupDistricts(input: {
  block: string | null;
  blocks: Blocks | null;
  /** The assignment digests of the plans on screen, from the bundle's stats. */
  fingerprints: { finished: string; before: string };
  shapes: Parameters<typeof districtsAt>[0];
  at: LonLat;
}): { districts: PlanDistricts; exact: boolean } {
  const { blocks, fingerprints } = input;
  const usable = blocks !== null && blocks.fingerprints.finished === fingerprints.finished && blocks.fingerprints.before === fingerprints.before;
  const exact = input.block !== null && usable ? districtsForBlock(blocks, input.block) : null;
  return exact ? { districts: exact, exact: true } : { districts: districtsAt(input.shapes, input.at), exact: false };
}

/** How long a same-page search waits for the block file before answering from the simplified shapes. */
export const BLOCKS_WAIT_MS = 4000;

/**
 * Await the block file, then run `finish` (which locates, selects and navigates). If the page was destroyed in
 * the meantime nothing runs, so a late answer cannot navigate the visitor back. A failed or slow (past
 * `waitMs`) load still finishes with the simplified-shape answer, and a load that lands after that is ignored.
 */
export async function finishWhenLoaded(
  load: Promise<Blocks | null>,
  opts: { alive: () => boolean; setBlocks: (b: Blocks | null) => void; finish: () => string; fallback: string; waitMs?: number },
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), opts.waitMs ?? BLOCKS_WAIT_MS);
  });
  const b = await Promise.race([load.catch(() => null), stalled]);
  clearTimeout(timer);
  if (!opts.alive()) return opts.fallback;
  opts.setBlocks(b);
  return opts.finish();
}

/**
 * The arrival path: the page opened with a located address and the block file is still loading. Once it lands (and
 * the page is alive) the blocks are kept and the address relocated. Resolves to the district to select, 'render'
 * when only a redraw is needed, or null when nothing must happen (page destroyed, or the load failed and the
 * simplified-shape answer stands). `before` is the district the shapes gave; `selected` is read after the load so
 * it reflects what the visitor chose meanwhile.
 */
export async function afterArrivalLoad(opts: {
  load: Promise<Blocks | null>;
  alive: () => boolean;
  setBlocks: (b: Blocks | null) => void;
  /** Re-runs the lookup with the blocks now set and returns the located district. */
  relocate: () => number | null;
  before: number | null;
  selected: () => number | null;
}): Promise<number | 'render' | null> {
  let b: Blocks | null;
  try {
    b = await opts.load;
  } catch {
    return null;
  }
  if (!opts.alive()) return null;
  opts.setBlocks(b);
  const next = exactSelection({ before: opts.before, after: opts.relocate(), selected: opts.selected() });
  return next ?? 'render';
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
