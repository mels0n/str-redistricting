import mapshaper from 'mapshaper';
import { DataError } from '../../shared/errors/index.js';

interface GeoJsonLike {
  readonly features: readonly { readonly geometry: { readonly coordinates?: unknown } | null }[];
}

export function vertexCount(fc: GeoJsonLike): number {
  const walk = (c: unknown): number =>
    Array.isArray(c) && typeof c[0] === 'number' ? 1 : Array.isArray(c) ? c.reduce((s: number, x: unknown) => s + walk(x), 0) : 0;
  return fc.features.reduce((s, f) => s + walk(f.geometry?.coordinates), 0);
}

/** Share of vertices to keep so a layer ends up near `budget` vertices; never more than all of them. */
export function simplifyPercent(vertices: number, budget: number): number {
  if (vertices <= 0) return 100;
  return Math.min(100, Math.max(0.05, (budget / vertices) * 100));
}

/** Vertex budget for a state's district layer; grows with the number of districts. */
export const districtBudget = (seats: number): number => 5000 + 5000 * seats;

/**
 * Convert a polygon FeatureCollection to quantized TopoJSON, simplifying along shared arcs so
 * neighbouring districts keep exactly the same border. Visvalingam keeps each shape from collapsing.
 */
export async function toTopology(fc: GeoJsonLike, layer: string, budget: number): Promise<string> {
  const pct = simplifyPercent(vertexCount(fc), budget);
  const simplify = pct >= 100 ? '' : `-simplify visvalingam weighted keep-shapes ${pct.toFixed(4)}% `;
  const cmd = `-i in.json ${simplify}-rename-layers ${layer} -o out.json format=topojson quantization=100000`;
  const out = await mapshaper.applyCommands(cmd, { 'in.json': JSON.stringify({ type: 'FeatureCollection', features: fc.features }) });
  const body = out['out.json'];
  if (body === undefined) throw new DataError(`mapshaper produced no output for ${layer}`);
  return typeof body === 'string' ? body : Buffer.from(body).toString('utf8');
}
