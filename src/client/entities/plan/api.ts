import { feature, mesh, neighbors } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Feature, FeatureCollection, MultiLineString, MultiPolygon, Polygon } from 'geojson';
import { dataUrl, fetchJson, DataShapeError, districtPalette } from '../../shared';
import {
  CutsSchema,
  DistrictTopoSchema,
  EnactedTopoSchema,
  WaterTopoSchema,
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

/** The part of a state's districts that lies over water (lakes, bays, coastal water), for display only. */
export type WaterShapes = FeatureCollection<Polygon | MultiPolygon>;

export interface StateBundle {
  abbr: string;
  stats: Stats;
  finished: PlanShapes;
  before: PlanShapes;
  cuts: Cut[];
  /** The water mask, or null when the state has none (the map is then drawn without it). */
  water: WaterShapes | null;
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

/** The water mask for a state. A missing or unreadable file is not an error: the map just has no water wash. */
function loadWater(abbr: string): Promise<WaterShapes | null> {
  return fetchJson(dataUrl(`${abbr}/water.topo.json`), WaterTopoSchema)
    .then((raw) => {
      const topo = raw as unknown as Topology<{ water: GeometryCollection }>;
      return feature(topo, topo.objects.water) as unknown as WaterShapes;
    })
    .catch(() => null);
}

/** A state's numbers alone (both plans, every district), without any shapes. */
export function loadStats(abbr: string): Promise<Stats> {
  return fetchJson(dataUrl(`${abbr}/stats.json`), StatsSchema);
}

const bundles = new Map<string, Promise<StateBundle>>();

/** Loads everything a state view needs except the enacted districts. */
export function loadStateBundle(abbr: string): Promise<StateBundle> {
  let p = bundles.get(abbr);
  if (!p) {
    const finishedUrl = dataUrl(`${abbr}/districts.topo.json`);
    const beforeUrl = dataUrl(`${abbr}/before.topo.json`);
    p = Promise.all([
      loadStats(abbr),
      fetchJson(finishedUrl, DistrictTopoSchema),
      fetchJson(beforeUrl, DistrictTopoSchema),
      fetchJson(dataUrl(`${abbr}/cuts.json`), CutsSchema),
      loadWater(abbr),
    ]).then(([stats, finishedTopo, beforeTopo, cuts, water]) => {
      const seats = stats.finished.metrics.seats;
      if (cuts.length !== seats - 1) {
        throw new DataShapeError(dataUrl(`${abbr}/cuts.json`), `expected ${seats - 1} cuts, found ${cuts.length}`);
      }
      const finished = toShapes(finishedTopo as unknown as DistrictTopology, finishedUrl, seats);
      const before = toShapes(beforeTopo as unknown as DistrictTopology, beforeUrl, seats);
      const slots = assignColors(unionNeighbors(finished.neighbors, before.neighbors), districtPalette.length);
      return {
        abbr,
        stats,
        finished,
        before,
        cuts: [...cuts].sort((a, b) => a.order - b.order),
        water,
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

/** The enacted Congress's districts, for display only. Loaded when first shown. */
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
