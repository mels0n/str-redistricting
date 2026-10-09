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
  /** public/data/index.json differs between base and head in an assignment or input hash, or in its state list. */
  mapsDataChanged: boolean;
}

export function versionProblems(p: VersionCheckInput): string[] {
  const problems: string[] = [];
  const bumped = (c: Component): boolean => identity(p.base, c) !== identity(p.head, c);
  for (const c of COMPONENTS) {
    if (c === 'maps') {
      // Maps follow the content of public/data (its hashes), not which paths a pull request touched.
      if (p.mapsDataChanged && !bumped(c)) {
        problems.push('maps: the published assignment or input hashes in public/data/index.json changed but maps was not bumped in config/versions.json');
      }
      if (!p.mapsDataChanged && bumped(c) && !(bumped('engine') || bumped('input'))) {
        problems.push('maps: bumped in config/versions.json but the published assignment and input hashes did not change');
      }
    } else if (p.touched.has(c) && !bumped(c)) {
      problems.push(`${c}: its files changed but ${c} was not bumped in config/versions.json (npm run release proposes the bump)`);
    }
    if (c !== 'maps' && !p.touched.has(c) && bumped(c)) {
      problems.push(`${c}: bumped in config/versions.json but none of its files changed`);
    }
    if (p.changelogs[c].includes('—')) problems.push(`changelog/${c}.md contains an em dash; use a period, comma or parentheses`);
  }
  return problems;
}
