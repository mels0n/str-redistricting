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
