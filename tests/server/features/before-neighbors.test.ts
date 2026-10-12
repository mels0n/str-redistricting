import { neighbors } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { describe, expect, it } from 'vitest';
import { BeforeNeighborsSchema, buildBeforeNeighbors, toTopology } from '../../../src/server/features/publish/index.js';

/** A unit square at grid cell (col, row) as district `n`. */
function cell(n: number, col: number, row: number) {
  const [x, y] = [-100 + col * 0.1, 10 + row * 0.1];
  const ring = [[x, y], [x + 0.1, y], [x + 0.1, y + 0.1], [x, y + 0.1], [x, y]];
  return { type: 'Feature' as const, properties: { district: n }, geometry: { type: 'Polygon' as const, coordinates: [ring] } };
}

/** The viewer's derivation (entities/plan toShapes): sort by district number, then topojson-client neighbors. */
function viewerNeighbors(topologyJson: string): number[][] {
  const topo = JSON.parse(topologyJson) as Topology<{ districts: GeometryCollection<{ district: number }> }>;
  const dOf = (g: { properties?: unknown }): number => (g.properties as { district: number }).district;
  const geoms = [...topo.objects.districts.geometries].sort((a, b) => dOf(a) - dOf(b));
  return neighbors(geoms).map((l) => [...l].sort((a, b) => a - b));
}

describe('before-neighbors.json', () => {
  // 2x2 grid listed out of order: 1 2 / 3 4. Diagonals meet only at a corner, which is not a shared border.
  const features = [cell(4, 1, 1), cell(1, 0, 0), cell(3, 0, 1), cell(2, 1, 0)];

  it('matches the neighbors the viewer derives from the same topology', async () => {
    const topo = await toTopology({ features }, 'districts', 1000);
    const file = JSON.parse(buildBeforeNeighbors(topo, 4)) as { neighbors: number[][] };
    expect(file.neighbors).toEqual(viewerNeighbors(topo));
    expect(file.neighbors).toEqual([[1, 2], [0, 3], [0, 3], [1, 2]]);
  });

  it('is symmetric, sorted and passes its own schema', async () => {
    const topo = await toTopology({ features }, 'districts', 1000);
    expect(BeforeNeighborsSchema.safeParse(JSON.parse(buildBeforeNeighbors(topo, 4))).success).toBe(true);
  });

  it('refuses a topology with the wrong number of districts', async () => {
    const topo = await toTopology({ features }, 'districts', 1000);
    expect(() => buildBeforeNeighbors(topo, 5)).toThrow(/expected 5 districts, found 4/);
  });

  it('rejects an asymmetric list', () => {
    expect(BeforeNeighborsSchema.safeParse({ neighbors: [[1], []] }).success).toBe(false);
    expect(BeforeNeighborsSchema.safeParse({ neighbors: [[0]] }).success).toBe(false);
    expect(BeforeNeighborsSchema.safeParse({ neighbors: [[2], [0]] }).success).toBe(false);
  });
});
