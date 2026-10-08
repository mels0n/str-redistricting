import type { Versions } from '../../shared/config/index.js';
import type { Commit, Component } from './components.js';

export type Level = 'major' | 'minor' | 'patch';

export function levelOf(commits: readonly Commit[]): Level | null {
  if (commits.length === 0) return null;
  if (commits.some((c) => c.breaking)) return 'major';
  if (commits.some((c) => c.type === 'feat')) return 'minor';
  return 'patch';
}

export function bumpSemver(v: string, level: Level): string {
  const [major, minor, patch] = v.split('.').map(Number) as [number, number, number];
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

export interface BumpInput {
  byComponent: ReadonlyMap<Component, readonly Commit[]>;
  /** The fixture gate found a changed fingerprint. */
  engineOutputChanged: boolean;
  /** inputSha256Of the files as they are now. */
  inputSha256: string;
}

function nextSemver(current: string, commits: readonly Commit[], capMinor: boolean): { next: string; level: Level | null } {
  let level = levelOf(commits);
  if (capMinor && level === 'major') level = 'minor';
  return { next: level === null ? current : bumpSemver(current, level), level };
}

export function proposeVersions(current: Versions, p: BumpInput): { next: Versions; reasons: string[] } {
  const reasons: string[] = [];
  const next: Versions = { ...current, input: { ...current.input } };

  if (p.engineOutputChanged) {
    next.engine = bumpSemver(current.engine, 'major');
    reasons.push(`engine ${next.engine}: the fixture fingerprints changed, so the maps change`);
  } else {
    const e = nextSemver(current.engine, p.byComponent.get('engine') ?? [], true);
    next.engine = e.next;
    if (e.level !== null) reasons.push(`engine ${next.engine}: ${e.level} (assignments unchanged)`);
  }

  const inputChanged = p.inputSha256 !== current.input.sha256;
  if (inputChanged) {
    next.input.revision = current.input.revision + 1;
    next.input.sha256 = p.inputSha256;
    reasons.push(`input ${next.input.vintage} r${next.input.revision}: the Census manifest or enacted config changed`);
  }

  const engineChanged = next.engine !== current.engine;
  if ((engineChanged || inputChanged) && (p.byComponent.get('maps')?.length ?? 0) > 0) {
    next.maps = current.maps + 1;
    reasons.push(`maps ${next.maps}: engine or input moved and the published data changed`);
  }

  for (const c of ['schema', 'web', 'docs'] as const) {
    const r = nextSemver(current[c], p.byComponent.get(c) ?? [], false);
    next[c] = r.next;
    if (r.level !== null) reasons.push(`${c} ${next[c]}: ${r.level}`);
  }
  return { next, reasons };
}
