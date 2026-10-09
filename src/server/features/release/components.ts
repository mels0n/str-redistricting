import { z } from 'zod';

export const COMPONENTS = ['engine', 'input', 'maps', 'schema', 'web', 'docs'] as const;
export type Component = (typeof COMPONENTS)[number];

const Globs = z.array(z.string().min(1));
const PerComponent = z.record(z.enum(COMPONENTS), Globs);

/** config/release.json: which files belong to which component. Globs: `**` crosses directories, `*` does not. */
export const ReleaseConfigSchema = z.strictObject({
  /** false: version-check only warns. Flipped to true at the 1.0 cut. */
  enforce: z.boolean(),
  paths: PerComponent,
  exclude: PerComponent,
  /** Files that belong to no component (tests, workflows, the versions file itself). */
  ignore: Globs,
  /** Commit types whose client files count as docs, not web. */
  docsTypes: z.array(z.string().min(1)),
  /** States the fixture gate draws on every pull request: small and fast, covering islands, water and a one-seat state. */
  fixtureStates: z.array(z.string().regex(/^[A-Z]{2}$/)),
});
export type ReleaseConfig = z.infer<typeof ReleaseConfigSchema>;

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

/** The components one changed file belongs to (none for an ignored file). */
export function componentsOfFile(file: string, cfg: ReleaseConfig): Component[] {
  if (matchesGlob(file, cfg.ignore)) return [];
  return COMPONENTS.filter((c) => matchesGlob(file, cfg.paths[c]) && !matchesGlob(file, cfg.exclude[c]));
}

/**
 * The components a commit touches. A docs-type commit (copy, docs) counts its client files as docs, not web; its engine
 * and data files still count for their own components.
 */
export function componentsFor(c: Commit, cfg: ReleaseConfig): Set<Component> {
  const docsType = cfg.docsTypes.includes(c.type);
  const out = new Set<Component>();
  for (const file of c.files) {
    for (const comp of componentsOfFile(file, cfg)) out.add(docsType && comp === 'web' ? 'docs' : comp);
  }
  return out;
}
