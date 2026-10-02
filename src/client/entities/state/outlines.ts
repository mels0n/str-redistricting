import { z } from 'zod';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { dataUrl, fetchJson, DataShapeError } from '../../shared';

const OutlineTopoSchema = z.looseObject({
  type: z.literal('Topology'),
  arcs: z.array(z.unknown()),
  objects: z.object({
    states: z.looseObject({
      type: z.literal('GeometryCollection'),
      geometries: z.array(
        z.looseObject({ properties: z.object({ abbr: z.string(), name: z.string() }) }),
      ),
    }),
  }),
});

export type StateOutline = Feature<Polygon | MultiPolygon, { abbr: string; name: string }>;

let outlines: Promise<FeatureCollection<Polygon | MultiPolygon, { abbr: string; name: string }>> | null = null;

/** State outlines for the national map and as quiet context around a state. */
export function loadOutlines(): Promise<FeatureCollection<Polygon | MultiPolygon, { abbr: string; name: string }>> {
  if (!outlines) {
    const url = dataUrl('states.topo.json');
    outlines = fetchJson(url, OutlineTopoSchema).then((topo) => {
      const t = topo as unknown as Topology<{ states: GeometryCollection<{ abbr: string; name: string }> }>;
      const fc = feature(t, t.objects.states);
      if (fc.type !== 'FeatureCollection') throw new DataShapeError(url, 'states is not a collection');
      return fc as FeatureCollection<Polygon | MultiPolygon, { abbr: string; name: string }>;
    });
    outlines.catch(() => {
      outlines = null;
    });
  }
  return outlines;
}
