import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { legislativeFileName, legislativeUrl, type LegislativeChamber } from '../../entities/legislative-boundary/index.js';
import { STATES } from '../../shared/apportionment/index.js';
import { EnactedConfigSchema, type EnactedConfig } from '../../shared/config/index.js';
import { ConfigError, DataError } from '../../shared/errors/index.js';
import { ENACTED_JSON, formatEnacted } from './bump.js';
import { isServed, type ProbeOptions } from './detect.js';

const CHAMBERS: readonly LegislativeChamber[] = ['state-house', 'state-senate'];

/** The state probed for a new vintage: every state's files are published together, so one stands for all. */
const PROBE_STATE = STATES.find((s) => s.abbr === 'AL')!;

export interface LegislativeDetection {
  readonly update: boolean;
  /** The vintage to adopt when `update`, else the pinned one. */
  readonly vintage: number;
}

/** Whether the Census Bureau already serves the next legislative vintage (probed on one state's State Senate file). */
export async function detectLegislative(current: Pick<EnactedConfig, 'legislative'>, opts: ProbeOptions = {}): Promise<LegislativeDetection> {
  const vintage = current.legislative.vintage + 1;
  const served = await isServed(legislativeUrl(legislativeFileName(PROBE_STATE, 'state-senate', vintage)), opts);
  return served ? { update: true, vintage } : { update: false, vintage: current.legislative.vintage };
}

/**
 * `detectLegislative` for a caller that also reports the congressional result: a failed probe is reported as
 * `{update: false, error: 'probe failed'}` instead of throwing, so it cannot take the congressional detection down with it.
 */
export async function detectLegislativeSafely(
  current: Pick<EnactedConfig, 'legislative'>,
  opts: ProbeOptions = {},
): Promise<LegislativeDetection & { readonly error?: string }> {
  try {
    return await detectLegislative(current, opts);
  } catch {
    return { update: false, vintage: current.legislative.vintage, error: 'probe failed' };
  }
}

/** The enacted config after adopting legislative `vintage`; an equal or older one is refused. */
export function planLegislativeBump(current: EnactedConfig, vintage: number): EnactedConfig {
  if (vintage <= current.legislative.vintage) {
    throw new ConfigError(`legislative vintage ${vintage} is not newer than the pinned ${current.legislative.vintage}`);
  }
  return EnactedConfigSchema.parse({ ...current, legislative: { vintage } });
}

type Counts = Readonly<Record<string, Readonly<Partial<Record<LegislativeChamber, number>>>>>;

/** One line per state chamber whose district count changed (states in name order, house before senate). */
export function redrawLines(before: Counts, after: Counts): string[] {
  const lines: string[] = [];
  for (const abbr of Object.keys(before).sort()) {
    for (const chamber of CHAMBERS) {
      const was = before[abbr]?.[chamber];
      const now = after[abbr]?.[chamber];
      if (was !== undefined && now !== undefined && was !== now) lines.push(`${abbr} ${chamber}: ${was} to ${now} districts; redraw needed`);
    }
  }
  return lines;
}

/**
 * Refuses a vintage in which a chamber that had districts has none: a state does not lose a whole chamber between
 * releases, so an empty count means the files were read wrongly (a bad download or a changed layout), not a real change.
 */
export function checkNoChamberLost(before: Counts, after: Counts): void {
  for (const abbr of Object.keys(before).sort()) {
    for (const chamber of CHAMBERS) {
      const was = before[abbr]?.[chamber] ?? 0;
      const now = after[abbr]?.[chamber] ?? 0;
      if (was > 0 && now === 0) throw new DataError(`${abbr} ${chamber}: ${was} districts before, 0 in the new files; refusing the update, check the downloaded files`);
    }
  }
}

/** Read config/enacted.json from `configDir`, adopt legislative `vintage` and write it back. */
export async function applyLegislativeBump(configDir: string, vintage: number): Promise<EnactedConfig> {
  const path = join(configDir, ENACTED_JSON);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    throw new DataError(`${path}: could not be read as JSON`);
  }
  const current = EnactedConfigSchema.safeParse(raw);
  if (!current.success) throw new DataError(`${path}: ${current.error.issues.map((i) => i.message).join('; ')}`);
  const next = planLegislativeBump(current.data, vintage);
  await writeFile(path, formatEnacted(next));
  return next;
}
