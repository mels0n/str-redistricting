import type { Block } from '../../src/server/entities/census-block/index.js';
import { createContext, type SplitContext } from '../../src/server/features/splitline/index.js';
import type { Piece } from '../../src/server/features/splitline/scan.js';

/** The piece a cut over `members` (block indices; all blocks by default) would sweep, built as findCut builds it. */
export function pieceOf(blocksOrCtx: readonly Block[] | SplitContext, members?: readonly number[]): Piece {
  const ctx = 'topo' in blocksOrCtx ? blocksOrCtx : createContext(blocksOrCtx);
  const topo = ctx.topo;
  const ids = members ?? ctx.blocks.map((_, i) => i);
  const m = ids.length;
  const localOf = new Int32Array(topo.n).fill(-1);
  ids.forEach((g, i) => { localOf[g] = i; });
  const lOff = new Int32Array(m + 1), adj: number[] = [], len: number[] = [];
  for (let i = 0; i < m; i++) {
    const g = ids[i]!;
    for (let k = topo.adjOffsets[g]!; k < topo.adjOffsets[g + 1]!; k++) {
      const j = localOf[topo.adjList[k]!]!;
      // Whole micrometers, as in the engine.
      if (j >= 0) { adj.push(j); len.push(Math.round(topo.adjLength[k]! * 1e6)); }
    }
    lOff[i + 1] = adj.length;
  }
  const pops = Float64Array.from(ids, (g) => ctx.blocks[g]!.pop);
  return {
    m, ids: Int32Array.from(ids), pops, total: pops.reduce((a, b) => a + b, 0),
    px: Float64Array.from(ids, (g) => ctx.px[g]!), py: Float64Array.from(ids, (g) => ctx.py[g]!),
    lOff, lAdj: Int32Array.from(adj), lLen: Float64Array.from(len),
  };
}
