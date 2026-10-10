import { DataError } from '../../shared/errors/index.js';
import { buildTopology, type Block, type Topology } from '../../entities/census-block/index.js';
import { gnomonic, type Gnomonic } from '../../shared/geo/index.js';

export interface SplitContext {
  readonly blocks: readonly Block[];
  readonly topo: Topology;
  readonly proj: Gnomonic;
  readonly px: Float64Array;
  readonly py: Float64Array;
}

/** Projection center = center of the bounding box of all block internal points. */
export function createContext(blocks: readonly Block[], topo?: Topology): SplitContext {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const b of blocks) {
    minLon = Math.min(minLon, b.point[0]); maxLon = Math.max(maxLon, b.point[0]);
    minLat = Math.min(minLat, b.point[1]); maxLat = Math.max(maxLat, b.point[1]);
  }
  const proj = gnomonic([(minLon + maxLon) / 2, (minLat + maxLat) / 2]);
  const px = new Float64Array(blocks.length);
  const py = new Float64Array(blocks.length);
  blocks.forEach((b, i) => {
    try {
      const [x, y] = proj.forward(b.point);
      px[i] = x; py[i] = y;
    } catch (err) {
      if (err instanceof RangeError) throw new DataError(`block ${b.geoid}: ${err.message}`);
      throw err;
    }
  });
  return { blocks, topo: topo ?? buildTopology(blocks), proj, px, py };
}
