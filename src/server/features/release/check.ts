import type { Versions } from '../../shared/config/index.js';
import { COMPONENTS, type Component } from './components.js';

function identity(v: Versions, c: Component): string {
  return c === 'input' ? `${v.input.vintage}/${v.input.revision}` : String(v[c]);
}

export interface VersionCheckInput {
  base: Versions;
  head: Versions;
  /** Components whose files changed between base and head. */
  touched: ReadonlySet<Component>;
  /** Text of changelog/<component>.md at head. */
  changelogs: Readonly<Record<Component, string>>;
}

export function versionProblems(p: VersionCheckInput): string[] {
  const problems: string[] = [];
  const bumped = (c: Component): boolean => identity(p.base, c) !== identity(p.head, c);
  for (const c of COMPONENTS) {
    if (p.touched.has(c) && !bumped(c)) {
      problems.push(`${c}: its files changed but ${c} was not bumped in config/versions.json (npm run release proposes the bump)`);
    }
    if (!p.touched.has(c) && bumped(c)) {
      // A maps release follows an engine or input bump even when no data file changed in the same PR.
      if (!(c === 'maps' && (bumped('engine') || bumped('input')))) {
        problems.push(`${c}: bumped in config/versions.json but none of its files changed`);
      }
    }
    if (p.changelogs[c].includes('—')) problems.push(`changelog/${c}.md contains an em dash; use a period, comma or parentheses`);
  }
  return problems;
}
