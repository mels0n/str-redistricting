import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { DataError } from '../../shared/errors/index.js';

/** The fields of a plan's metrics.json the examples read; any others pass through. */
export const MetricsSchema = z.object({
  state: z.string(),
  seats: z.number().int().positive(),
  population: z.number(),
  ideal: z.number(),
  districts: z.array(z.object({ district: z.number().int().positive(), pop: z.number() })),
  assignmentSha256: z.string(),
}).passthrough();
export type Metrics = z.infer<typeof MetricsSchema>;

/** candidates.json: one row per candidate line, per cut (in cut order); `fields` names the columns. */
export const CandidatesSchema = z.object({
  fields: z.array(z.string()),
  cuts: z.array(z.array(z.array(z.number()))),
});
export type Candidates = z.infer<typeof CandidatesSchema>;

const CutStat = z.object({
  order: z.number().int(),
  depth: z.number().int(),
  seats: z.number().int(),
  /** 0-based index of the first district the piece will become. */
  firstDistrict: z.number().int(),
  angleDeg: z.number(),
  lengthM: z.number(),
}).passthrough();
export const CutStatsSchema = z.object({ cuts: z.array(CutStat) }).passthrough();
export type CutStats = z.infer<typeof CutStatsSchema>;

const Move = z.object({
  block: z.number().int(),
  geoid: z.string(),
  from: z.number().int(),
  to: z.number().int(),
  pop: z.number(),
  gain: z.number(),
});
export const BalanceSchema = z.object({ before: z.array(z.number().int().nonnegative()).min(1), moves: z.array(Move) });
export type Balance = z.infer<typeof BalanceSchema>;

export interface StateOutput {
  readonly metrics: Metrics;
  readonly candidates: Candidates;
  readonly cutStats: CutStats;
  readonly balance: Balance;
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
    readJson(join(dir, 'metrics.json'), MetricsSchema),
    readJson(join(dir, 'candidates.json'), CandidatesSchema),
    readJson(join(dir, 'cut-stats.json'), CutStatsSchema),
    readJson(join(dir, 'balance.json'), BalanceSchema),
    readAssignment(join(dir, 'assignment.csv')),
    readAssignment(join(dir, 'before-balancing', 'assignment.csv')),
  ]);
  return { metrics, candidates, cutStats, balance, assignment, before };
}

/** Metrics of a plan directory, or undefined when it has not been generated. */
export async function loadMetricsIfPresent(outDir: string, abbr: string): Promise<Metrics | undefined> {
  const path = join(outDir, abbr, 'metrics.json');
  return existsSync(path) ? readJson(path, MetricsSchema) : undefined;
}

/** GEOIDs of the blocks in the piece a cut works on: districts firstDistrict+1 .. firstDistrict+seats (1-based) before balancing. */
export function pieceMembers(before: ReadonlyMap<string, number>, firstDistrict: number, seats: number): Set<string> {
  const members = new Set<string>();
  for (const [geoid, district] of before) {
    if (district > firstDistrict && district <= firstDistrict + seats) members.add(geoid);
  }
  return members;
}
