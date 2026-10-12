import { feature, mesh, neighbors } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Feature, FeatureCollection, MultiLineString, MultiPolygon, Polygon } from 'geojson';
import { dataUrl, fetchJson, checkRelease, DataShapeError, districtPalette, chamberDataPath, type Chamber } from '../../shared';
import {
  CutsSchema,
  DistrictTopoSchema,
  EnactedTopoSchema,
  WaterTopoSchema,
  BridgesSchema,
  BeforeNeighborsSchema,
  type Bridges,
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
  chamber: Chamber;
  stats: Stats;
  finished: PlanShapes;
  /** The plan before balancing, or null until loadBefore has fetched it (only that plan and the replays read it). */
  before: PlanShapes | null;
  cuts: Cut[];
  /** The water mask, or null when the state has none (the map is then drawn without it). */
  water: WaterShapes | null;
  /** The island links, or null when the file is missing or unreadable (nothing is then drawn or said about links). */
  bridges: Bridges | null;
  /**
   * Fill color for each district, by district index (district 1 at 0). Both plans' neighbors are kept apart from the first
   * paint when the state publishes before-neighbors.json. For older data the colors keep only the finished map's neighbors
   * apart until loadBefore has the before-balancing shapes, then keep both plans' apart.
   */
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
function loadWater(dir: string): Promise<WaterShapes | null> {
  return fetchJson(dataUrl(`${dir}/water.topo.json`), WaterTopoSchema)
    .then((raw) => {
      const topo = raw as unknown as Topology<{ water: GeometryCollection }>;
      return feature(topo, topo.objects.water) as unknown as WaterShapes;
    })
    .catch(() => null);
}

/** The island links for a state. A missing or unreadable file is not an error: the map just has no links. */
function loadBridges(dir: string): Promise<Bridges | null> {
  return fetchJson(dataUrl(`${dir}/bridges.json`), BridgesSchema).catch(() => null);
}

/**
 * The before-balancing plan's district neighbors, which fix the district colors from the first paint. A missing or
 * unreadable file (older data) is not an error: the colors are then worked out once the plan loads.
 */
function loadBeforeNeighbors(dir: string): Promise<number[][] | null> {
  return fetchJson(dataUrl(`${dir}/before-neighbors.json`), BeforeNeighborsSchema)
    .then((file) => file.neighbors)
    .catch(() => null);
}

/** Bundles whose colors already account for both plans, so loadBefore leaves them alone. */
const colorsFinal = new WeakSet<StateBundle>();

/**
 * A state's numbers alone (both plans, every district), without any shapes. It also checks the state's stamp for
 * release skew (see checkRelease), so loading stats can reload the app when a newer release went out.
 */
export function loadStats(abbr: string, chamber: Chamber = 'federal-house'): Promise<Stats> {
  return fetchJson(dataUrl(`${chamberDataPath(abbr, chamber)}/stats.json`), StatsSchema).then((stats) => {
    void checkRelease(stats.versions);
    return stats;
  });
}

const bundles = new Map<string, Promise<StateBundle>>();

/** Loads everything a state view needs except the enacted districts. */
export function loadStateBundle(abbr: string, chamber: Chamber = 'federal-house'): Promise<StateBundle> {
  const dir = chamberDataPath(abbr, chamber);
  let p = bundles.get(dir);
  if (!p) {
    const finishedUrl = dataUrl(`${dir}/districts.topo.json`);
    p = Promise.all([
      loadStats(abbr, chamber),
      fetchJson(finishedUrl, DistrictTopoSchema),
      fetchJson(dataUrl(`${dir}/cuts.json`), CutsSchema),
      loadWater(dir),
      loadBridges(dir),
      loadBeforeNeighbors(dir),
    ]).then(([stats, finishedTopo, cuts, water, bridges, rawNeighbors]) => {
      const seats = stats.finished.metrics.seats;
      if (cuts.length !== seats - 1) {
        throw new DataShapeError(dataUrl(`${dir}/cuts.json`), `expected ${seats - 1} cuts, found ${cuts.length}`);
      }
      const finished = toShapes(finishedTopo as unknown as DistrictTopology, finishedUrl, seats);
      // A list of the wrong size is treated as absent: the colors are then worked out after loadBefore.
      const beforeNeighbors = rawNeighbors && rawNeighbors.length === seats && rawNeighbors.every((l) => l.every((j) => j < seats)) ? rawNeighbors : null;
      const slots = assignColors(beforeNeighbors ? unionNeighbors(finished.neighbors, beforeNeighbors) : finished.neighbors, districtPalette.length);
      const bundle: StateBundle = {
        abbr,
        chamber,
        stats,
        finished,
        before: null,
        cuts: [...cuts].sort((a, b) => a.order - b.order),
        water,
        bridges,
        colors: slots.map((s) => districtPalette[s]!.hex),
      };
      if (beforeNeighbors) colorsFinal.add(bundle);
      return bundle;
    });
    p.catch(() => bundles.delete(dir));
    bundles.set(dir, p);
  }
  return p;
}

const befores = new Map<string, Promise<PlanShapes>>();

/**
 * Fetches the plan before balancing, once per chamber's data, and sets it on the state's bundle (loading the bundle first
 * if needed). Only the "Before balancing" view and the cut and balancing replays read it, so the finished map does not wait for it.
 */
export function loadBefore(abbr: string, chamber: Chamber = 'federal-house'): Promise<PlanShapes> {
  const dir = chamberDataPath(abbr, chamber);
  let p = befores.get(dir);
  if (!p) {
    const beforeUrl = dataUrl(`${dir}/before.topo.json`);
    p = Promise.all([loadStateBundle(abbr, chamber), fetchJson(beforeUrl, DistrictTopoSchema)]).then(([bundle, topo]) => {
      const before = toShapes(topo as unknown as DistrictTopology, beforeUrl, bundle.stats.finished.metrics.seats);
      if (!colorsFinal.has(bundle)) {
        const slots = assignColors(unionNeighbors(bundle.finished.neighbors, before.neighbors), districtPalette.length);
        bundle.colors = slots.map((s) => districtPalette[s]!.hex);
      }
      bundle.before = before;
      return before;
    });
    p.catch(() => befores.delete(dir));
    befores.set(dir, p);
  }
  return p;
}

export interface EnactedShapes {
  lines: MultiLineString;
  features: Feature<Polygon | MultiPolygon, { label: string; code: string }>[];
}

const enacted = new Map<string, Promise<EnactedShapes>>();

/** The enacted Congress's districts, for display only. Loaded when first shown. */
export function loadEnacted(abbr: string, chamber: Chamber = 'federal-house'): Promise<EnactedShapes> {
  const dir = chamberDataPath(abbr, chamber);
  let p = enacted.get(dir);
  if (!p) {
    p = fetchJson(dataUrl(`${dir}/enacted.topo.json`), EnactedTopoSchema).then((raw) => {
      const topo = raw as unknown as Topology<{ enacted: GeometryCollection<{ label: string; code: string }> }>;
      const fc = feature(topo, topo.objects.enacted) as FeatureCollection<Polygon | MultiPolygon, { label: string; code: string }>;
      return { lines: mesh(topo, topo.objects.enacted), features: fc.features };
    });
    p.catch(() => enacted.delete(dir));
    enacted.set(dir, p);
  }
  return p;
}
