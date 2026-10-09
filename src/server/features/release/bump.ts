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

/** Negative when a is the lower version, positive when higher, 0 when equal. */
export function compareSemver(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The versions as of each component's newest release tag; a component with no tag is left out and measured from its current version. */
export interface TaggedVersions {
  engine?: string;
  inputRevision?: number;
  maps?: number;
  schema?: string;
  web?: string;
  docs?: string;
}

export interface BumpInput {
  byComponent: ReadonlyMap<Component, readonly Commit[]>;
  /** The fixture gate found a changed fingerprint. */
  engineOutputChanged: boolean;
  /** inputSha256Of the files as they are now. */
  inputSha256: string;
  /** public/data/index.json hashes differ from the ones at the last maps release. */
  mapsDataChanged?: boolean;
  /**
   * The versions at the newest tags. The proposal is worked out from these and the commits since the tag, then the
   * higher of that and the current version wins: a bump made since the tag is kept, raised if later commits call for a
   * bigger one, and never made twice.
   */
  tagged?: TaggedVersions;
}

function nextSemver(from: string, commits: readonly Commit[], capMinor: boolean): { next: string; level: Level | null } {
  let level = levelOf(commits);
  if (capMinor && level === 'major') level = 'minor';
  return { next: level === null ? from : bumpSemver(from, level), level };
}

const higher = (a: string, b: string): string => (compareSemver(a, b) >= 0 ? a : b);

export function proposeVersions(current: Versions, p: BumpInput): { next: Versions; reasons: string[] } {
  const reasons: string[] = [];
  const next: Versions = { ...current, input: { ...current.input } };
  const tagged = p.tagged ?? {};

  const engineFrom = tagged.engine ?? current.engine;
  let engineWhy: string;
  let engineProposed: string;
  if (p.engineOutputChanged) {
    engineProposed = bumpSemver(engineFrom, 'major');
    engineWhy = 'the fixture fingerprints changed, so the maps change';
  } else {
    const e = nextSemver(engineFrom, p.byComponent.get('engine') ?? [], true);
    engineProposed = e.next;
    engineWhy = `${e.level ?? 'patch'} (assignments unchanged)`;
  }
  next.engine = higher(current.engine, engineProposed);
  if (next.engine !== current.engine) reasons.push(`engine ${next.engine}: ${engineWhy}`);

  if (p.inputSha256 !== current.input.sha256) {
    next.input.revision = Math.max(current.input.revision, (tagged.inputRevision ?? current.input.revision) + 1);
    next.input.sha256 = p.inputSha256;
    reasons.push(`input ${next.input.vintage} r${next.input.revision}: the Census manifest or enacted config changed`);
  }

  // The maps release follows a new engine major or input revision since the last maps release (the next publish draws
  // different maps), or published hashes that already moved since then.
  const engineMajorMoved = Number(next.engine.split('.')[0]) > Number((tagged.engine ?? current.engine).split('.')[0]);
  const inputMoved = next.input.revision > (tagged.inputRevision ?? current.input.revision);
  const mapsFrom = tagged.maps ?? current.maps;
  if (engineMajorMoved || inputMoved || p.mapsDataChanged === true) {
    next.maps = Math.max(current.maps, mapsFrom + 1);
    if (next.maps !== current.maps) {
      reasons.push(`maps ${next.maps}: ${engineMajorMoved || inputMoved ? 'the engine major or the input moved, so the published data changes' : 'the published assignment or input hashes changed'}`);
    }
  }

  for (const c of ['schema', 'web', 'docs'] as const) {
    const r = nextSemver(tagged[c] ?? current[c], p.byComponent.get(c) ?? [], false);
    next[c] = higher(current[c], r.next);
    if (next[c] !== current[c]) reasons.push(`${c} ${next[c]}: ${r.level ?? 'patch'}`);
  }
  return { next, reasons };
}
