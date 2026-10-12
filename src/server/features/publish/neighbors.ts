import { neighbors } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { z } from 'zod';
import { DataError } from '../../shared/errors/index.js';

/**
 * The published `before-neighbors.json`: which districts of the before-balancing plan touch which. `neighbors[i]` lists
 * the 0-based indexes of the districts adjacent to district i + 1, sorted and without repeats. The relation is symmetric,
 * and no district lists itself.
 */
export const BeforeNeighborsSchema = z
  .object({ neighbors: z.array(z.array(z.number().int().nonnegative())) })
  .superRefine((file, ctx) => {
    const n = file.neighbors.length;
    file.neighbors.forEach((list, i) => {
      const ok = list.every((j, k) => j < n && j !== i && (k === 0 || list[k - 1]! < j) && file.neighbors[j]!.includes(i));
      if (!ok) ctx.addIssue({ code: 'custom', message: `district ${i + 1} has an invalid neighbor list` });
    });
  });
export type BeforeNeighbors = z.infer<typeof BeforeNeighborsSchema>;

type Props = { district?: number };

/**
 * The district adjacency of a published topology, derived exactly as the viewer derives it from the same file
 * (topojson-client `neighbors` over the district geometries sorted by district number), so it is the relation the
 * viewer would compute itself once the topology has loaded.
 */
export function buildBeforeNeighbors(topologyJson: string, seats: number): string {
  const topo = JSON.parse(topologyJson) as Topology<{ districts: GeometryCollection<Props> }>;
  const dOf = (g: { properties?: Props }): number => g.properties?.district ?? 0;
  const geoms = [...topo.objects.districts.geometries].sort((a, b) => dOf(a) - dOf(b));
  if (geoms.length !== seats) throw new DataError(`before.topo.json: expected ${seats} districts, found ${geoms.length}`);
  const file = BeforeNeighborsSchema.safeParse({ neighbors: neighbors(geoms).map((list) => [...new Set(list)].sort((a, b) => a - b)) });
  if (!file.success) throw new DataError(`before-neighbors.json: ${file.error.issues.map((i) => i.message).join('; ')}`);
  return JSON.stringify(file.data);
}
