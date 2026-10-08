import type { Block } from '../../src/server/entities/census-block/index.js';

export interface GridOptions {
  size?: number;                                    // degrees per cell
  origin?: readonly [number, number];               // lon/lat of cell (0,0) corner
  pop?: (x: number, y: number) => number;
  skip?: (x: number, y: number) => boolean;
  water?: (x: number, y: number) => boolean;        // block with no land area
  geoidPrefix?: string;                             // 5 chars: state+county
  indexOffset?: number;
}

/** Row-major grid of square blocks; GEOIDs sort in row-major order. */
export function gridBlocks(w: number, h: number, opts: GridOptions = {}): Block[] {
  const size = opts.size ?? 0.01;
  const [ox, oy] = opts.origin ?? [0, 0];
  const out: Block[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (opts.skip?.(x, y)) continue;
      const x0 = ox + x * size, y0 = oy + y * size, x1 = x0 + size, y1 = y0 + size;
      const idx = (opts.indexOffset ?? 0) + y * w + x;
      out.push({
        geoid: (opts.geoidPrefix ?? '00000') + String(idx).padStart(10, '0'),
        pop: opts.pop?.(x, y) ?? 1,
        point: [x0 + size / 2, y0 + size / 2],
        rings: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
        ...(opts.water?.(x, y) ? { water: true } : {}),
      });
    }
  }
  return out;
}
