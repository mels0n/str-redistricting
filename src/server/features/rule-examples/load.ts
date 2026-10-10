import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  BalanceLogSchema, CandidatesSchema, CutsGeoSchema, CutStatsSchema, PlanMetricsSchema,
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

/** Joins each cut's first-side seat count (cuts.geojson) onto cut-stats.json by cut order, never by position. */
export function withLowSeats(stats: CutStats, geo: { features: readonly { properties: { order: number; lowSeats: number } }[] }): CutStats {
  const lowByOrder = new Map(geo.features.map((f) => [f.properties.order, f.properties.lowSeats] as const));
  return { ...stats, cuts: stats.cuts.map((c) => ({ ...c, lowSeats: lowByOrder.get(c.order) })) };
}

export async function loadStateOutput(outDir: string, abbr: string): Promise<StateOutput> {
  const dir = join(outDir, abbr);
  const [metrics, candidates, rawCutStats, cutsGeo, balance, assignment, before] = await Promise.all([
    readJson(join(dir, 'metrics.json'), PlanMetricsSchema),
    readJson(join(dir, 'candidates.json'), CandidatesSchema),
    readJson(join(dir, 'cut-stats.json'), CutStatsSchema),
    readJson(join(dir, 'cuts.geojson'), CutsGeoSchema),
    readJson(join(dir, 'balance.json'), BalanceLogSchema),
    readAssignment(join(dir, 'assignment.csv')),
    readAssignment(join(dir, 'before-balancing', 'assignment.csv')),
  ]);
  // cut-stats.json leaves out which side got the smaller share; cuts.geojson has it, keyed by cut order.
  const cutStats = withLowSeats(rawCutStats, cutsGeo);
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

/** Just a state's cut-stats.json (without the first-side seat counts), without loading the rest of its output. */
export function loadCutStats(outDir: string, abbr: string): Promise<CutStats> {
  return readJson(join(outDir, abbr, 'cut-stats.json'), CutStatsSchema);
}

/** A numeric field of a record whose schema passes extra fields through. */
export function numberField(rec: object, key: string, what: string): number {
  const v = (rec as Record<string, unknown>)[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new DataError(`${what}: no number "${key}"`);
  return v;
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

/**
 * The candidates.json row of the range a cut chose. A range is told apart by its first-side seat count, whether it
 * is a line slid from the other end, and its bounding directions (the same pair of directions can come up once per way of splitting the seats).
 */
export function chosenCandidate(out: StateOutput, cutIndex: number): Record<string, number> {
  const cut = out.cutStats.cuts[cutIndex];
  const rows = out.candidates.cuts[cutIndex];
  if (!cut || !rows) throw new DataError(`${out.metrics.state}: no cut ${cutIndex + 1} in the cut data`);
  if (cut.lowSeats === undefined) throw new DataError(`${out.metrics.state}: cut ${cut.order} has no first-side seat count`);
  const { fields } = out.candidates;
  const lowAt = fields.indexOf('lowSeats'), fromAt = fields.indexOf('fromDeg'), toAt = fields.indexOf('toDeg'), lenAt = fields.indexOf('lengthM');
  if (lowAt < 0 || fromAt < 0 || toAt < 0 || lenAt < 0) throw new DataError(`${out.metrics.state}: candidates.json is missing the lowSeats, fromDeg, toDeg or lengthM column`);
  // A line slid from the other end can bound the same directions as an ordinary one; older files have no such column.
  const revAt = fields.indexOf('reversed'), rev = cut.reversed === true ? 1 : 0;
  const matches = rows.filter((r) => r[lowAt] === cut.lowSeats && r[fromAt] === cut.fromDeg && r[toAt] === cut.toDeg && (revAt < 0 || (r[revAt] ?? 0) === rev));
  if (matches.length !== 1) throw new DataError(`${out.metrics.state}: cut ${cut.order} matches ${matches.length} rows of candidates.json for ${cut.fromDeg} to ${cut.toDeg}, lowSeats=${cut.lowSeats}`);
  const row = matches[0]!;
  if (Math.round(row[lenAt]!) !== Math.round(cut.lengthM)) throw new DataError(`${out.metrics.state}: cut ${cut.order} length ${cut.lengthM} differs from its candidate row (${row[lenAt]})`);
  return Object.fromEntries(fields.map((f, i) => [f, row[i] ?? 0]));
}
