import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BridgesOutSchema } from '../../entities/plan-output/index.js';
import { DataError } from '../../shared/errors/index.js';
import { crossesAntimeridian, unwrapLon } from './antimeridian.js';

/** One island link as published: both end points and the 1-based district of each end under each plan. */
export interface PublishedBridge {
  readonly a: readonly [number, number];
  readonly b: readonly [number, number];
  readonly finished: readonly [number, number];
  readonly before: readonly [number, number];
}
export interface PublishedBridges { readonly links: readonly PublishedBridge[] }

const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;
/** A state drawn past -180 (Alaska) gets its link ends unwrapped like every other published shape. */
const lonOf = (abbr: string, lon: number): number => r6(crossesAntimeridian(abbr) ? unwrapLon(lon) : lon);

/** GEOID -> district from an assignment.csv (`GEOID20,district`). */
export function districtsByGeoid(csv: string, label: string): Map<string, number> {
  const out = new Map<string, number>();
  const lines = csv.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '') continue;
    const comma = line.indexOf(',');
    const d = Number(line.slice(comma + 1));
    if (comma < 1 || !Number.isInteger(d) || d < 1) throw new DataError(`${label} line ${i + 1} is malformed: ${line}`);
    out.set(line.slice(0, comma), d);
  }
  return out;
}

/**
 * The island links of one state for the viewer. `count` is the `bridges` figure in the plan's metrics.json:
 * with none, the links file is not needed; with some, out/<ST>/bridges.json must exist (re-run explore if it does not).
 */
export async function buildPublishedBridges(
  srcDir: string, abbr: string, count: number, finishedCsv: string, beforeCsv: string,
): Promise<PublishedBridges> {
  if (count === 0) return { links: [] };
  const path = join(srcDir, 'bridges.json');
  if (!existsSync(path)) throw new DataError(`${abbr}: metrics.json reports ${count} island links but ${path} is missing; re-run explore for ${abbr}`);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new DataError(`${path}: not valid JSON; re-run explore for ${abbr}`);
  }
  const parsed = BridgesOutSchema.safeParse(raw);
  if (!parsed.success) throw new DataError(`${path}: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  if (parsed.data.links.length !== count) throw new DataError(`${abbr}: ${path} has ${parsed.data.links.length} links but metrics.json reports ${count}; re-run explore for ${abbr}`);
  const finished = districtsByGeoid(finishedCsv, `${abbr} assignment.csv`);
  const before = districtsByGeoid(beforeCsv, `${abbr} before-balancing/assignment.csv`);
  const of = (m: Map<string, number>, g: string): number => {
    const d = m.get(g);
    if (d === undefined) throw new DataError(`${abbr}: island link block ${g} is not in the assignment`);
    return d;
  };
  return {
    links: parsed.data.links.map((l) => ({
      a: [lonOf(abbr, l.aPoint[0]), r6(l.aPoint[1])],
      b: [lonOf(abbr, l.bPoint[0]), r6(l.bPoint[1])],
      finished: [of(finished, l.a), of(finished, l.b)],
      before: [of(before, l.a), of(before, l.b)],
    })),
  };
}
