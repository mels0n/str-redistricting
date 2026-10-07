import mapshaper from 'mapshaper';
import { DataError } from '../../shared/errors/index.js';

export interface ArcFeature {
  readonly type: 'Feature';
  readonly properties: { readonly a: number; readonly b: number };
  readonly geometry: { readonly type: 'LineString'; readonly coordinates: [number, number][] };
}

interface PlanLike {
  readonly features: readonly { readonly properties: { readonly district: number }; readonly geometry: unknown }[];
}

interface Topology {
  readonly arcs: [number, number][][];
  readonly objects: Record<string, { readonly geometries: readonly TopoGeometry[] }>;
}

interface TopoGeometry {
  readonly type: string;
  readonly arcs?: unknown;
  readonly geometries?: readonly TopoGeometry[];
  readonly properties?: { readonly district?: number } | null;
}

/** Collect every arc id (`~i` folded back to `i`) used by a Polygon/MultiPolygon arc tree. */
function collectArcs(node: unknown, out: number[]): void {
  if (!Array.isArray(node)) return;
  for (const item of node) {
    if (typeof item === 'number') out.push(item < 0 ? ~item : item);
    else collectArcs(item, out);
  }
}

/**
 * Split a district plan into border arcs, each tagged with the districts on its two sides
 * (`b = 0` on the plan's outer edge; `a < b` otherwise). Mapshaper builds the shared topology
 * with no simplification and no quantization, so every vertex is kept exactly.
 */
export async function districtArcs(fc: PlanLike): Promise<ArcFeature[]> {
  const input = JSON.stringify({ type: 'FeatureCollection', features: fc.features });
  const out = await mapshaper.applyCommands('-i in.json -o out.json format=topojson no-quantization', { 'in.json': input });
  const body = out['out.json'];
  if (body === undefined) throw new DataError('mapshaper produced no output for district arcs');
  const topo = JSON.parse(typeof body === 'string' ? body : Buffer.from(body).toString('utf8')) as Topology;

  const first = new Int32Array(topo.arcs.length); // first district seen on each arc, 0 = none
  const second = new Int32Array(topo.arcs.length); // a different second district, 0 = none
  const visit = (g: TopoGeometry): void => {
    if (g.type === 'GeometryCollection') {
      for (const child of g.geometries ?? []) visit(child);
      return;
    }
    const district = g.properties?.district;
    if (typeof district !== 'number' || g.arcs === undefined) return;
    const ids: number[] = [];
    collectArcs(g.arcs, ids);
    for (const id of ids) {
      if (first[id] === 0) first[id] = district;
      else if (first[id] !== district) second[id] = district;
    }
  };
  for (const layer of Object.values(topo.objects)) for (const g of layer.geometries) visit(g);

  const arcs: ArcFeature[] = [];
  topo.arcs.forEach((coordinates, id) => {
    const one = first[id] ?? 0;
    const two = second[id] ?? 0;
    if (one === 0) return;
    // A third district on one arc means overlapping input; the topology cannot be tagged honestly.
    const a = two === 0 ? one : Math.min(one, two);
    const b = two === 0 ? 0 : Math.max(one, two);
    arcs.push({ type: 'Feature', properties: { a, b }, geometry: { type: 'LineString', coordinates } });
  });
  return arcs;
}
