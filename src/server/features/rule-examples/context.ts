import type { Block, BlockPolygons, Topology } from '../../entities/census-block/index.js';
import { buildTopology, loadBlockPolygons, loadStateBlocks } from '../../entities/census-block/index.js';
import { stateByAbbr } from '../../shared/apportionment/index.js';
import type { RuleExamplesConfig } from '../../shared/config/index.js';
import { DataError } from '../../shared/errors/index.js';
import type { PlanMetrics } from '../../entities/plan-output/index.js';
import { loadMetricsIfPresent, loadStateOutput, type StateOutput } from './load.js';

export interface StateBlocks {
  /** Sorted by GEOID, as the generator sees them. */
  readonly blocks: Block[];
  readonly topo: Topology;
  /** Polygons of just these blocks, read from the cached TIGER file. */
  polys(geoids: ReadonlySet<string>): Promise<Map<string, BlockPolygons>>;
}

/** Everything a case builder may read; each state is loaded once and shared across builders. */
export interface ExtractContext {
  readonly cfg: RuleExamplesConfig;
  state(abbr: string): Promise<StateOutput>;
  /** Metrics of the repeat run in the repeat directory, or undefined when that run is absent. */
  repeatMetrics(abbr: string): Promise<PlanMetrics | undefined>;
  blocks(abbr: string): Promise<StateBlocks>;
}

const memo = <T>(cache: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> => {
  let hit = cache.get(key);
  if (!hit) { hit = make(); cache.set(key, hit); }
  return hit;
};

export function createExtractContext(cfg: RuleExamplesConfig): ExtractContext {
  const outputs = new Map<string, Promise<StateOutput>>();
  const repeats = new Map<string, Promise<PlanMetrics | undefined>>();
  const blockSets = new Map<string, Promise<StateBlocks>>();
  return {
    cfg,
    state: (abbr) => memo(outputs, abbr, () => loadStateOutput(cfg.outDir, abbr)),
    repeatMetrics: (abbr) => memo(repeats, abbr, () => loadMetricsIfPresent(cfg.repeatDir, abbr)),
    blocks: (abbr) => memo(blockSets, abbr, async () => {
      const info = stateByAbbr(abbr);
      if (!info) throw new DataError(`unknown state: ${abbr}`);
      const blocks = await loadStateBlocks(info, cfg.rawDir);
      return { blocks, topo: buildTopology(blocks), polys: (geoids) => loadBlockPolygons(info, cfg.rawDir, geoids) };
    }),
  };
}
