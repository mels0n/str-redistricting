import type { LonLat } from '../../shared/geo/index.js';

export interface Block {
  readonly geoid: string;
  readonly pop: number;
  readonly point: LonLat;
  readonly rings: readonly (readonly LonLat[])[];
}

/** District index (0-based) for each block, by block index. */
export type Assignment = Int32Array;
