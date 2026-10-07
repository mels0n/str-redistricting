import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  BalanceLogSchema, CandidatesSchema, CutStatsSchema, PlanMetricsSchema,
  type BalanceLog, type Candidates, type CutStats, type PlanMetrics,
} from '../../entities/plan-output/index.js';
import { DataError } from '../../shared/errors/index.js';

export interface StateOutput {
  readonly metrics: PlanMetrics;
  readonly candidates: Candidates;
  readonly cutStats: CutStats;
  readonly balance: BalanceLog;
  /** Final plan: GEOID to 1-based district. */
  readonly assignment: Map<string, number>;
  /** Plan before balancing: GEOID to 1-based district. */
  readonly before: Map<string, number>;
}

async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = JSON.parse((await readFile(path, 'utf8')).replace(/^﻿/, ''));
  } catch {
    throw new DataError(`cannot read ${path}`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new DataError(`${path}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  return parsed.data;
}

async function readAssignment(path: string): Promise<Map<string, number>> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    throw new DataError(`cannot read ${path}`);
  }
  const out = new Map<string, number>();
  for (const line of text.split('\n').slice(1)) {
    const row = line.trim();
    if (!row) continue;
    const comma = row.indexOf(',');
    const district = Number(row.slice(comma + 1));
    if (comma < 1 || !Number.isInteger(district)) throw new DataError(`${path}: malformed row "${row.slice(0, 40)}"`);
    out.set(row.slice(0, comma), district);
  }
  return out;
}

export async function loadStateOutput(outDir: string, abbr: string): Promise<StateOutput> {
  const dir = join(outDir, abbr);
  const [metrics, candidates, cutStats, balance, assignment, before] = await Promise.all([
    readJson(join(dir, 'metrics.json'), PlanMetricsSchema),
    readJson(join(dir, 'candidates.json'), CandidatesSchema),
    readJson(join(dir, 'cut-stats.json'), CutStatsSchema),
    readJson(join(dir, 'balance.json'), BalanceLogSchema),
    readAssignment(join(dir, 'assignment.csv')),
    readAssignment(join(dir, 'before-balancing', 'assignment.csv')),
  ]);
  return { metrics, candidates, cutStats, balance, assignment, before };
}

/** Abbreviations of the states with a generated candidates.json under an output directory, in order. */
export function generatedStates(outDir: string): string[] {
  if (!existsSync(outDir)) return [];
  return readdirSync(outDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^[A-Z]{2}$/.test(e.name) && existsSync(join(outDir, e.name, 'candidates.json')))
    .map((e) => e.name)
    .sort();
}

/** Just a state's candidates.json, without loading the rest of its output. */
export function loadCandidates(outDir: string, abbr: string): Promise<Candidates> {
  return readJson(join(outDir, abbr, 'candidates.json'), CandidatesSchema);
}

/** Metrics of a plan directory, or undefined when it has not been generated. */
export async function loadMetricsIfPresent(outDir: string, abbr: string): Promise<PlanMetrics | undefined> {
  const path = join(outDir, abbr, 'metrics.json');
  return existsSync(path) ? readJson(path, PlanMetricsSchema) : undefined;
}

/** GEOIDs of the blocks in the piece a cut works on: districts firstDistrict+1 .. firstDistrict+seats (1-based) before balancing. */
export function pieceMembers(before: ReadonlyMap<string, number>, firstDistrict: number, seats: number): Set<string> {
  const members = new Set<string>();
  for (const [geoid, district] of before) {
    if (district > firstDistrict && district <= firstDistrict + seats) members.add(geoid);
  }
  return members;
}

/** The candidate row of the line a cut chose: same direction index and length, one row per side. */
export function chosenCandidate(out: StateOutput, cutIndex: number): Record<string, number> {
  const cut = out.cutStats.cuts[cutIndex];
  const rows = out.candidates.cuts[cutIndex];
  if (!cut || !rows) throw new DataError(`${out.metrics.state}: no cut ${cutIndex + 1} in the cut data`);
  const k = Math.round(cut.angleDeg / out.metrics.angleStepDeg);
  const { fields } = out.candidates;
  const kAt = fields.indexOf('k'), lenAt = fields.indexOf('lengthM');
  const row = rows.find((r) => r[kAt] === k && r[lenAt] === cut.lengthM);
  if (!row) throw new DataError(`${out.metrics.state}: cut ${cut.order} chose a line that is not in candidates.json`);
  return Object.fromEntries(fields.map((f, i) => [f, row[i] ?? 0]));
}
