import type { LonLat } from '../../shared/geo/index.js';

export interface Block {
  readonly geoid: string;
  readonly pop: number;
  readonly point: LonLat;
  readonly rings: readonly (readonly LonLat[])[];
  /** No land area and no people (ALAND20 and POP20 are 0): lake, bay or coastal water. Read only by the balancing pass. */
  readonly water?: boolean;
}

/** District index (0-based) for each block, by block index. */
export type Assignment = Int32Array;
