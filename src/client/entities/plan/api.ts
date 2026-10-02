import { feature, mesh, neighbors } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Feature, FeatureCollection, MultiLineString, MultiPolygon, Polygon } from 'geojson';
import { dataUrl, fetchJson, DataShapeError, districtPalette } from '../../shared';
import {
  CutsSchema,
  DistrictTopoSchema,
  EnactedTopoSchema,
  StatsSchema,
  type Cut,
  type Stats,
} from './model';
import { assignColors, unionNeighbors } from './coloring';

export type DistrictFeature = Feature<Polygon | MultiPolygon, { district: number }>;
type DistrictTopology = Topology<{ districts: GeometryCollection<{ district: number }> }>;

/** One plan's shapes, ready for the map. */
export interface PlanShapes {
  /** Districts sorted by number, district 1 first. */
  features: DistrictFeature[];
  /** Lines between districts. */
  borders: MultiLineString;
  /** The state's outline. */
  outline: MultiLineString;
  /** 0-based neighbor lists, by district index. */
  neighbors: number[][];
  /** Lines between pieces, for a given piece assignment (see piecesAfter). */
  pieceBorders(piece: readonly number[]): MultiLineString;
}

export interface StateBundle {
  abbr: string;
  stats: Stats;
  official: PlanShapes;
  before: PlanShapes;
  cuts: Cut[];
  /** Fill color for each district, by district index (district 1 at 0). */
  colors: string[];
}

function toShapes(topo: DistrictTopology, url: string, seats: number): PlanShapes {
  const obj = topo.objects.districts;
  // Sort the geometries by district number so index i is district i + 1.
  const dOf = (g: { properties?: unknown }): number => (g.properties as { district?: number } | undefined)?.district ?? 0;
  const geoms = [...obj.geometries].sort((a, b) => dOf(a) - dOf(b));
  if (geoms.length !== seats) throw new DataShapeError(url, `expected ${seats} districts, found ${geoms.length}`);
  const sorted: GeometryCollection<{ district: number }> = { ...obj, geometries: geoms };
  const fc = feature(topo, sorted) as FeatureCollection<Polygon | MultiPolygon, { district: number }>;
  return {
    features: fc.features,
    borders: mesh(topo, sorted, (a, b) => a !== b),
    outline: mesh(topo, sorted, (a, b) => a === b),
    neighbors: neighbors(geoms),
    pieceBorders(piece) {
      return mesh(topo, sorted, (a, b) => a !== b && piece[dOf(a) - 1] !== piece[dOf(b) - 1]);
    },
  };
}

const bundles = new Map<string, Promise<StateBundle>>();

/** Loads everything a state view needs except the enacted districts. */
export function loadStateBundle(abbr: string): Promise<StateBundle> {
  let p = bundles.get(abbr);
  if (!p) {
    const officialUrl = dataUrl(`${abbr}/districts.topo.json`);
    const beforeUrl = dataUrl(`${abbr}/before.topo.json`);
    p = Promise.all([
      fetchJson(dataUrl(`${abbr}/stats.json`), StatsSchema),
      fetchJson(officialUrl, DistrictTopoSchema),
      fetchJson(beforeUrl, DistrictTopoSchema),
      fetchJson(dataUrl(`${abbr}/cuts.json`), CutsSchema),
    ]).then(([stats, officialTopo, beforeTopo, cuts]) => {
      const seats = stats.official.metrics.seats;
      if (cuts.length !== seats - 1) {
        throw new DataShapeError(dataUrl(`${abbr}/cuts.json`), `expected ${seats - 1} cuts, found ${cuts.length}`);
      }
      const official = toShapes(officialTopo as unknown as DistrictTopology, officialUrl, seats);
      const before = toShapes(beforeTopo as unknown as DistrictTopology, beforeUrl, seats);
      const slots = assignColors(unionNeighbors(official.neighbors, before.neighbors), districtPalette.length);
      return {
        abbr,
        stats,
        official,
        before,
        cuts: [...cuts].sort((a, b) => a.order - b.order),
        colors: slots.map((s) => districtPalette[s]!.hex),
      };
    });
    p.catch(() => bundles.delete(abbr));
    bundles.set(abbr, p);
  }
  return p;
}

export interface EnactedShapes {
  lines: MultiLineString;
  features: Feature<Polygon | MultiPolygon, { label: string; code: string }>[];
}

const enacted = new Map<string, Promise<EnactedShapes>>();

/** Today's enacted districts, for display only. Loaded when first shown. */
export function loadEnacted(abbr: string): Promise<EnactedShapes> {
  let p = enacted.get(abbr);
  if (!p) {
    p = fetchJson(dataUrl(`${abbr}/enacted.topo.json`), EnactedTopoSchema).then((raw) => {
      const topo = raw as unknown as Topology<{ enacted: GeometryCollection<{ label: string; code: string }> }>;
      const fc = feature(topo, topo.objects.enacted) as FeatureCollection<Polygon | MultiPolygon, { label: string; code: string }>;
      return { lines: mesh(topo, topo.objects.enacted), features: fc.features };
    });
    p.catch(() => enacted.delete(abbr));
    enacted.set(abbr, p);
  }
  return p;
}
