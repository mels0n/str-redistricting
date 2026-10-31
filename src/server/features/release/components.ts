import { z } from 'zod';
import { DataError } from '../../shared/errors/index.js';

export const COMPONENTS = ['engine', 'input', 'maps', 'schema', 'web', 'docs'] as const;
export type Component = (typeof COMPONENTS)[number];

const Globs = z.array(z.string().min(1));
const PerComponent = z.record(z.enum(COMPONENTS), Globs);

/** A repo-relative path under src/: no leading slash, no drive letter, no `..`, no backslash. */
function isRepoSource(p: string): boolean {
  return p.startsWith('src/') && !p.includes(String.fromCharCode(92)) && !p.split('/').includes('..') && !p.includes(':');
}

/** config/release.json: which files belong to which component. Globs: `**` crosses directories, `*` does not. */
export const ReleaseConfigSchema = z.strictObject({
  /** false: version-check only warns. Flipped to true at the 1.0 cut. */
  enforce: z.boolean(),
  paths: PerComponent,
  exclude: PerComponent,
  /**
   * The entry points the engine is built from (repo-relative). When set, a file is engine exactly when the drawing
   * code imports it (the caller works that set out and passes it in), and `paths.engine` / `exclude.engine` are not used.
   * When absent, engine is the globs, as before.
   */
  engineEntries: z.array(z.string().refine(isRepoSource, 'an engine entry is a repo-relative path under src/')).min(1).optional(),
  /** Files that belong to no component (tests, workflows, the versions file itself). */
  ignore: Globs,
  /** Commit types whose client files count as docs, not web. */
  docsTypes: z.array(z.string().min(1)),
  /** States the fixture gate draws on every pull request: small and fast, covering islands, water and a one-seat state. */
  fixtureStates: z.array(z.string().regex(/^[A-Z]{2}(:state-(house|senate))?$/)),
}).superRefine((cfg, ctx) => {
  if (cfg.engineEntries !== undefined && (cfg.paths.engine.length > 0 || cfg.exclude.engine.length > 0)) {
    ctx.addIssue({ code: 'custom', message: 'engineEntries replaces paths.engine and exclude.engine; leave those empty' });
  }
});
export type ReleaseConfig = z.infer<typeof ReleaseConfigSchema>;

/** The parts of a release.json that classify a file. Older copies are read into this, so a later schema change never breaks them. */
export type ClassifyRules = Pick<ReleaseConfig, 'paths' | 'exclude' | 'ignore' | 'docsTypes' | 'engineEntries'>;

// A historical copy may predate keys the current schema requires or carry ones it no longer knows: pick only what classifies.
const HistoricalRulesSchema = z.looseObject({
  paths: z.record(z.string(), Globs).optional(),
  exclude: z.record(z.string(), Globs).optional(),
  ignore: Globs.optional(),
  docsTypes: z.array(z.string()).optional(),
  engineEntries: z.array(z.string()).optional(),
});

/** Leniently reads the classifying rules of any past release.json; a missing part is empty. */
export function parseClassifyRules(text: string): ClassifyRules {
  const raw: unknown = JSON.parse(text);
  const got = HistoricalRulesSchema.parse(raw);
  const per = (r: Record<string, string[]> | undefined): Record<Component, string[]> => Object.fromEntries(COMPONENTS.map((c) => [c, r?.[c] ?? []])) as Record<Component, string[]>;
  // The era is decided from the raw JSON: a copy that names engineEntries is graph-era, whatever else it holds.
  const graphEra = typeof raw === 'object' && raw !== null && 'engineEntries' in raw;
  return { paths: per(got.paths), exclude: per(got.exclude), ignore: got.ignore ?? [], docsTypes: got.docsTypes ?? [], engineEntries: graphEra ? (got.engineEntries ?? []) : undefined };
}

export interface Commit {
  sha: string;
  type: string;
  breaking: boolean;
  subject: string;
  files: string[];
}

/** `type(scope)!: text` as in conventional commits; anything else is type `other`. */
export function parseCommitSubject(subject: string): { type: string; breaking: boolean } {
  const m = /^([a-z]+)(?:\([^)]*\))?(!)?:\s/.exec(subject);
  return m === null ? { type: 'other', breaking: false } : { type: m[1]!, breaking: m[2] === '!' };
}

function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else {
      out += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

export function matchesGlob(path: string, globs: readonly string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}

/**
 * The components one changed file belongs to (none for an ignored file). `engineFiles` is the set of repo-relative
 * paths in the engine's import graph; it is required exactly when the config names `engineEntries`, and unused otherwise.
 * `release` builds it from HEAD's entries (today's graph plus the last engine release's); version-check from the fork
 * point and HEAD.
 */
export function componentsOfFile(file: string, cfg: ClassifyRules, engineFiles?: ReadonlySet<string>): Component[] {
  if (matchesGlob(file, cfg.ignore)) return [];
  if (cfg.engineEntries !== undefined && engineFiles === undefined) throw new DataError('release.json names engineEntries, but no engine file set was given');
  return COMPONENTS.filter((c) => {
    if (c === 'engine' && cfg.engineEntries !== undefined) return engineFiles!.has(file);
    return matchesGlob(file, cfg.paths[c]) && !matchesGlob(file, cfg.exclude[c]);
  });
}

/**
 * The components a commit touches. A docs-type commit (copy, docs) counts its client files as docs, not web; its engine
 * and data files still count for their own components. `engineFiles` is required exactly when `cfg.engineEntries` is set.
 */
export function componentsFor(c: Commit, cfg: ClassifyRules, engineFiles?: ReadonlySet<string>): Set<Component> {
  const docsType = cfg.docsTypes.includes(c.type);
  const out = new Set<Component>();
  for (const file of c.files) {
    for (const comp of componentsOfFile(file, cfg, engineFiles)) out.add(docsType && comp === 'web' ? 'docs' : comp);
  }
  return out;
}
