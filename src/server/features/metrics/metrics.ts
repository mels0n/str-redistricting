import { createHash } from 'node:crypto';
import { isConnected, type Block, type Topology } from '../../entities/census-block/index.js';

export interface DistrictMetrics {
  readonly district: number;
  readonly pop: number;
  readonly dev: number;
  readonly devPct: number;
  readonly contiguous: boolean;
}

export interface PlanMetrics {
  readonly seats: number;
  readonly blocks: number;
  readonly population: number;
  readonly ideal: number;
  readonly districts: readonly DistrictMetrics[];
  readonly rangePersons: number;
  readonly rangePct: number;
  readonly countiesSplit: number;
  readonly countiesTotal: number;
  readonly allContiguous: boolean;
  readonly assignmentSha256: string;
}

export function assignmentCsv(blocks: readonly Block[], assignment: Int32Array): string {
  let out = 'GEOID20,district\n';
  blocks.forEach((b, i) => { out += `${b.geoid},${assignment[i]! + 1}\n`; });
  return out;
}

export function computeMetrics(blocks: readonly Block[], topo: Topology, assignment: Int32Array, seats: number): PlanMetrics {
  const pops = new Array<number>(seats).fill(0);
  const lists: number[][] = Array.from({ length: seats }, () => []);
  const counties = new Map<string, Set<number>>();
  blocks.forEach((b, i) => {
    const d = assignment[i]!;
    pops[d]! += b.pop;
    lists[d]!.push(i);
    const c = b.geoid.slice(0, 5);
    if (!counties.has(c)) counties.set(c, new Set());
    counties.get(c)!.add(d);
  });
  const population = pops.reduce((s, x) => s + x, 0);
  const ideal = population / seats;
  const districts = pops.map((p, d) => ({
    district: d + 1,
    pop: p,
    dev: p - ideal,
    devPct: ((p - ideal) / ideal) * 100,
    contiguous: isConnected(topo, Int32Array.from(lists[d]!)),
  }));
  const rangePersons = Math.max(...pops) - Math.min(...pops);
  return {
    seats,
    blocks: blocks.length,
    population,
    ideal,
    districts,
    rangePersons,
    rangePct: (rangePersons / ideal) * 100,
    countiesSplit: [...counties.values()].filter((s) => s.size > 1).length,
    countiesTotal: counties.size,
    allContiguous: districts.every((d) => d.contiguous),
    assignmentSha256: createHash('sha256').update(assignmentCsv(blocks, assignment)).digest('hex'),
  };
}
