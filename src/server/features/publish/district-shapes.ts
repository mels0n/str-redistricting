import { geoMercator, geoPath } from 'd3-geo';
import { bbox, feature, neighbors } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { z } from 'zod';
import { DataError } from '../../shared/errors/index.js';

const TopoShape = z.looseObject({
  objects: z.looseObject({
    districts: z.looseObject({
      geometries: z.array(z.looseObject({ properties: z.looseObject({ district: z.number() }) })).min(1),
    }),
  }),
});

/** Same rule as the viewer: districts in number order, each takes the least-used slot none of its colored neighbors holds. */
function assignColors(adjacent: readonly (readonly number[])[], paletteSize: number): number[] {
  const slot = new Array<number>(adjacent.length).fill(-1);
  const used = new Array<number>(paletteSize).fill(0);
  adjacent.forEach((near, i) => {
    const taken = new Set(near.map((j) => slot[j]!).filter((s) => s >= 0));
    let best = -1;
    for (let c = 0; c < paletteSize; c++) if (!taken.has(c) && (best === -1 || used[c]! < used[best]!)) best = c;
    if (best === -1) best = i % paletteSize;
    slot[i] = best;
    used[best]!++;
  });
  return slot;
}

/** The `<path>` of every district of a state, colored by the viewer's rule and fitted to the box. */
export function districtShapes(p: {
  abbr: string;
  topo: string;
  palette: readonly string[];
  box: [[number, number], [number, number]];
  stroke: string;
  strokeWidth: number;
}): string {
  const parsed = TopoShape.safeParse(JSON.parse(p.topo));
  if (!parsed.success) throw new DataError(`${p.abbr}: districts topology is not usable for the preview image`);
  const topo = parsed.data as unknown as Topology;
  const collection = topo.objects['districts'] as GeometryCollection<{ district?: number }>;
  const number = (g: { properties?: object | null }): number => (g.properties as { district?: number } | null | undefined)?.district ?? 0;
  collection.geometries.sort((a, b) => number(a) - number(b));
  const slots = assignColors(neighbors(collection.geometries), p.palette.length);
  const features = feature(topo, collection);
  // Published frames can run past -180 degrees (Alaska); turn the globe so the state's center is the middle and nothing wraps.
  const [west, , east] = bbox(topo);
  const projection = geoMercator().rotate([-(west! + east!) / 2, 0]).fitExtent(p.box, features);
  const toPath = geoPath(projection);
  return features.features
    .map((f, i) => `<path d="${toPath(f) ?? ''}" fill="${p.palette[slots[i]!]!}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" stroke-linejoin="round"/>`)
    .join('');
}
