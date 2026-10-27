import { DataError } from '../../shared/errors/index.js';
import type { Office } from './schema.js';

/** Uppercase, no `DISTRICT`, no spaces or hyphens, and no leading zeros on a number (`012` and `12` agree). */
export function normalizeDistrict(code: string): string {
  return code.toUpperCase().replace(/DISTRICT/g, '').replace(/[\s-]+/g, '').replace(/^0+(?=[0-9])/, '');
}

export interface DistrictMatch {
  /** Enacted district code to the Open States district name it matched. */
  readonly matched: Record<string, string>;
  readonly unmatchedEnacted: string[];
  readonly unmatchedOpenStates: string[];
}

/**
 * Pair a state chamber's enacted districts with Open States' district names. Both sides are normalised; an alias
 * (keyed `<ST>:<office>:<enactedCode>`, valued with an Open States district name) names a pairing the codes do not;
 * where Open States splits one district into seats (Idaho's `1A` and `1B`) the value lists them joined by `|`, and
 * `matched` then holds that joined list too. A district counts as matched when at least one name is found.
 */
export function matchStateDistricts(
  state: string,
  office: Office,
  enactedCodes: readonly string[],
  openStatesDistricts: readonly string[],
  aliases: Readonly<Record<string, string>>,
): DistrictMatch {
  const byNormal = new Map<string, string>();
  for (const d of openStatesDistricts) {
    const n = normalizeDistrict(d);
    const seen = byNormal.get(n);
    // Two different names that normalise alike would be merged into one district; stop instead.
    if (seen !== undefined && seen !== d) throw new DataError(`${state} ${office}: Open States districts '${seen}' and '${d}' normalise to the same name`);
    byNormal.set(n, d);
  }
  const matched: Record<string, string> = {};
  const used = new Set<string>();
  const unmatchedEnacted: string[] = [];
  for (const code of enactedCodes) {
    const targets = (aliases[`${state}:${office}:${code}`] ?? code).split('|').map(normalizeDistrict);
    const found = targets.filter((t) => byNormal.has(t) && !used.has(t));
    if (found.length === 0) unmatchedEnacted.push(code);
    else {
      matched[code] = found.map((t) => byNormal.get(t)!).join('|');
      for (const t of found) used.add(t);
    }
  }
  const unmatchedOpenStates = [...new Set(openStatesDistricts)].filter((d) => !used.has(normalizeDistrict(d)));
  return { matched, unmatchedEnacted, unmatchedOpenStates };
}

/**
 * Problems in a state chamber's aliases, as readable lines (none means the aliases are sound). An alias must name an
 * enacted district, name Open States districts that exist exactly as spelled, be needed (the code does not already
 * match without it), and no Open States district may be claimed by two enacted districts.
 */
export function checkAliases(
  state: string,
  office: Office,
  enactedCodes: readonly string[],
  openStatesDistricts: readonly string[],
  aliases: Readonly<Record<string, string>>,
): string[] {
  const problems: string[] = [];
  const prefix = `${state}:${office}:`;
  const names = new Set(openStatesDistricts);
  const normals = new Set(openStatesDistricts.map(normalizeDistrict));
  const claimed = new Map<string, string>();
  for (const [key, value] of Object.entries(aliases)) {
    if (!key.startsWith(prefix)) continue;
    const code = key.slice(prefix.length);
    if (!enactedCodes.includes(code)) problems.push(`${key}: no such enacted district`);
    if (normals.has(normalizeDistrict(code))) problems.push(`${key}: the code already matches without an alias`);
    for (const part of value.split('|')) {
      if (!names.has(part)) problems.push(`${key}: '${part}' is not an Open States district`);
      const other = claimed.get(part);
      if (other !== undefined) problems.push(`${key}: '${part}' is also claimed by ${other}`);
      claimed.set(part, key);
    }
  }
  return problems;
}
