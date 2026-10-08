import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSIONS, type Versions } from '../../../src/server/shared/config/index.js';
import {
  COMPONENTS,
  FingerprintFileSchema,
  baseEngineMajor,
  ReleaseConfigSchema,
  bumpSemver,
  compareFingerprints,
  componentsFor,
  mapsDataChanged,
  newestTag,
  levelOf,
  parseCommitSubject,
  prependEntry,
  proposeVersions,
  tagsFor,
  versionProblems,
  type Commit,
  type Component,
} from '../../../src/server/features/release/index.js';

const cfg = ReleaseConfigSchema.parse(JSON.parse(readFileSync('config/release.json', 'utf8')));

function commit(subject: string, files: string[]): Commit {
  return { sha: 'abc1234', ...parseCommitSubject(subject), subject, files };
}
const base: Versions = VERSIONS;
const noChangelog = Object.fromEntries(COMPONENTS.map((c) => [c, `# ${c} changelog\n\n`])) as Record<Component, string>;
const byComponent = (entries: [Component, Commit[]][]): Map<Component, Commit[]> => new Map(entries);

describe('release config', () => {
  it('parses, and does not enforce yet', () => {
    expect(cfg.enforce).toBe(false);
    expect(cfg.docsTypes).toEqual(['copy', 'docs']);
  });
});

describe('parseCommitSubject', () => {
  it('reads conventional commits', () => {
    expect(parseCommitSubject('feat(map): add a thing')).toEqual({ type: 'feat', breaking: false });
    expect(parseCommitSubject('fix!: change the rule')).toEqual({ type: 'fix', breaking: true });
    expect(parseCommitSubject('refactor(x)!: y')).toEqual({ type: 'refactor', breaking: true });
    expect(parseCommitSubject('Merge pull request #11')).toEqual({ type: 'other', breaking: false });
  });
});

describe('componentsFor', () => {
  const of = (subject: string, files: string[]): Component[] => [...componentsFor(commit(subject, files), cfg)].sort();

  it('attributes by path', () => {
    expect(of('fix: x', ['src/server/features/splitline/cut.ts'])).toEqual(['engine']);
    expect(of('fix: x', ['src/server/features/publish/topo.ts'])).toEqual(['schema']);
    expect(of('fix: x', ['src/server/entities/plan-output/schema.ts'])).toEqual(['schema']);
    expect(of('chore: x', ['config/enacted.json'])).toEqual(['input']);
    expect(of('fix: x', ['src/client/app/main.ts', 'index.html', 'public/og-image.png'])).toEqual(['web']);
    expect(of('docs: x', ['README.md', 'docs/how.md'])).toEqual(['docs']);
  });
  it('attributes nothing for tests, workflows, the versions file and changelogs', () => {
    expect(of('test: x', ['tests/x.test.ts', '.github/workflows/a.yml', 'config/versions.json', 'changelog/maps.md'])).toEqual([]);
  });
  it('keeps release tooling and enacted and rule-example code out of the engine', () => {
    expect(of('feat: x', ['src/server/features/release/bump.ts', 'src/server/app/release.ts', 'src/server/features/enacted/bump.ts'])).toEqual([]);
  });
  it('attributes published data files to no component (maps follow the content hashes, not the paths)', () => {
    expect(of('fix: x', ['public/data/index.json', 'public/data/CO/assignments.json', 'public/data/CO/og.png', 'public/data/AL/blocks.pmtiles'])).toEqual([]);
  });
  it('keeps the Census watch and the shared HTTP helpers out of the engine', () => {
    expect(of('feat: x', ['src/server/features/census-watch/probe.ts', 'src/server/app/census-watch.ts', 'src/server/shared/http/fetch.ts'])).toEqual([]);
  });
  it('sends the client files of a copy commit to docs', () => {
    expect(of('copy(how): reword', ['src/client/pages/how/ui.ts'])).toEqual(['docs']);
    expect(of('fix: reword', ['src/client/pages/how/ui.ts'])).toEqual(['web']);
  });
  it('still counts the engine and data files of a docs-type commit for their own components', () => {
    expect(of('docs: x', ['src/client/pages/how/ui.ts', 'src/server/features/splitline/cut.ts'])).toEqual(['docs', 'engine']);
  });
  it('lands a commit in every component it touches', () => {
    expect(of('fix(balance): x', ['src/server/features/splitline/cut.ts', 'src/client/a.ts'])).toEqual(['engine', 'web']);
  });
});

describe('levelOf and bumpSemver', () => {
  it('ranks breaking over feat over the rest', () => {
    expect(levelOf([])).toBeNull();
    expect(levelOf([commit('fix: a', [])])).toBe('patch');
    expect(levelOf([commit('fix: a', []), commit('feat: b', [])])).toBe('minor');
    expect(levelOf([commit('feat: a', []), commit('fix!: b', [])])).toBe('major');
  });
  it('bumps', () => {
    expect(bumpSemver('1.2.3', 'patch')).toBe('1.2.4');
    expect(bumpSemver('1.2.3', 'minor')).toBe('1.3.0');
    expect(bumpSemver('1.2.3', 'major')).toBe('2.0.0');
  });
});

describe('proposeVersions', () => {
  const same = base.input.sha256;

  it('bumps the engine major when the output changed, even for a fix', () => {
    const { next } = proposeVersions(base, {
      byComponent: byComponent([['engine', [commit('fix: x', ['src/server/a.ts'])]]]),
      engineOutputChanged: true,
      inputSha256: same,
    });
    expect(next.engine).toBe('2.0.0');
  });
  it('bumps the engine minor for a feat that leaves the output alone, and caps a breaking commit at minor', () => {
    const feat = proposeVersions(base, { byComponent: byComponent([['engine', [commit('feat: x', [])]]]), engineOutputChanged: false, inputSha256: same });
    expect(feat.next.engine).toBe('1.1.0');
    const breaking = proposeVersions(base, { byComponent: byComponent([['engine', [commit('feat!: x', [])]]]), engineOutputChanged: false, inputSha256: same });
    expect(breaking.next.engine).toBe('1.1.0');
  });
  it('leaves everything alone when nothing happened', () => {
    const { next, reasons } = proposeVersions(base, { byComponent: new Map(), engineOutputChanged: false, inputSha256: same });
    expect(next).toEqual(base);
    expect(reasons).toEqual([]);
  });
  it('bumps the input revision and the maps release when the input sha differs', () => {
    const { next } = proposeVersions(base, {
      byComponent: new Map(),
      engineOutputChanged: false,
      inputSha256: 'f'.repeat(64),
    });
    expect(next.input.revision).toBe(2);
    expect(next.input.sha256).toBe('f'.repeat(64));
    expect(next.maps).toBe(2);
  });
  it('bumps maps with an engine major bump, but not with an engine minor', () => {
    const major = proposeVersions(base, { byComponent: new Map(), engineOutputChanged: true, inputSha256: same });
    expect([major.next.engine, major.next.maps]).toEqual(['2.0.0', 2]);
    const minor = proposeVersions(base, { byComponent: byComponent([['engine', [commit('feat: x', [])]]]), engineOutputChanged: false, inputSha256: same });
    expect([minor.next.engine, minor.next.maps]).toEqual(['1.1.0', 1]);
  });
  it('bumps maps when the published hashes changed since the maps tag, and not otherwise', () => {
    expect(proposeVersions(base, { byComponent: new Map(), engineOutputChanged: false, inputSha256: same, mapsDataChanged: true }).next.maps).toBe(2);
    expect(proposeVersions(base, { byComponent: new Map(), engineOutputChanged: false, inputSha256: same }).next.maps).toBe(1);
  });
  it('never bumps a component twice: already-bumped components are left as they are', () => {
    const bumped: Versions = { ...base, engine: '2.0.0', maps: 2, web: '1.1.0' };
    const { next, reasons } = proposeVersions(bumped, {
      byComponent: byComponent([
        ['engine', [commit('fix: x', [])]],
        ['web', [commit('feat: x', [])]],
        ['docs', [commit('docs: x', [])]],
      ]),
      engineOutputChanged: true,
      inputSha256: 'f'.repeat(64),
      mapsDataChanged: true,
      alreadyBumped: new Set<Component>(['engine', 'input', 'maps', 'web']),
    });
    expect([next.engine, next.maps, next.web, next.input.revision, next.docs]).toEqual(['2.0.0', 2, '1.1.0', 1, '1.0.1']);
    expect(reasons.join(' ')).not.toContain('engine');
  });
  it('takes schema, web and docs from their commit levels, with major allowed', () => {
    const { next } = proposeVersions(base, {
      byComponent: byComponent([
        ['schema', [commit('fix!: x', [])]],
        ['web', [commit('feat: x', [])]],
        ['docs', [commit('docs: x', [])]],
      ]),
      engineOutputChanged: false,
      inputSha256: same,
    });
    expect([next.schema, next.web, next.docs]).toEqual(['2.0.0', '1.1.0', '1.0.1']);
  });
  it('does not mutate its input', () => {
    const before = JSON.stringify(base);
    proposeVersions(base, { byComponent: new Map(), engineOutputChanged: true, inputSha256: 'f'.repeat(64) });
    expect(JSON.stringify(base)).toBe(before);
  });
});

describe('mapsDataChanged', () => {
  const index = (states: [string, string, string][]): string =>
    JSON.stringify({ states: states.map(([abbr, a, i]) => ({ abbr, name: abbr, summary: { assignmentSha256: a, inputSha256: i, population: 1 } })) });
  const base2 = index([['CO', 'a', 'x'], ['RI', 'b', 'x']]);

  it('is false when the file is absent at the base, or nothing relevant differs', () => {
    expect(mapsDataChanged(null, base2)).toBe(false);
    expect(mapsDataChanged(base2, base2)).toBe(false);
    expect(mapsDataChanged(base2, JSON.stringify({ ...JSON.parse(base2), extra: 1 }))).toBe(false);
  });
  it('is true when an assignment or input hash differs, or a state is added or removed', () => {
    expect(mapsDataChanged(base2, index([['CO', 'a2', 'x'], ['RI', 'b', 'x']]))).toBe(true);
    expect(mapsDataChanged(base2, index([['CO', 'a', 'y'], ['RI', 'b', 'x']]))).toBe(true);
    expect(mapsDataChanged(base2, index([['CO', 'a', 'x']]))).toBe(true);
    expect(mapsDataChanged(base2, index([['CO', 'a', 'x'], ['RI', 'b', 'x'], ['DE', 'c', 'x']]))).toBe(true);
    expect(mapsDataChanged(base2, null)).toBe(true);
  });
});

describe('mapsDataChanged with a declared Maps release', () => {
  const stamped = (states: [string, string, number | null][]): string =>
    JSON.stringify({ states: states.map(([abbr, a, maps]) => ({ abbr, summary: { assignmentSha256: a, inputSha256: 'x', ...(maps === null ? {} : { versions: { maps } }) } })) });
  const before = stamped([['CO', 'a', 1], ['RI', 'b', 1]]);

  it('covers changed states stamped with the release that was already declared', () => {
    const after = stamped([['CO', 'a2', 2], ['RI', 'b', 1]]);
    expect(mapsDataChanged(before, after)).toBe(true);
    expect(mapsDataChanged(before, after, { base: 2, head: 2 })).toBe(false);
  });
  it('does not cover a state stamped with an older release, an unstamped one, or a removed one', () => {
    expect(mapsDataChanged(before, stamped([['CO', 'a2', 1], ['RI', 'b', 1]]), { base: 2, head: 2 })).toBe(true);
    expect(mapsDataChanged(before, stamped([['CO', 'a2', null], ['RI', 'b', 1]]), { base: 2, head: 2 })).toBe(true);
    expect(mapsDataChanged(before, stamped([['CO', 'a', 1]]), { base: 2, head: 2 })).toBe(true);
  });
  it('does not cover anything when this change bumps the Maps release itself', () => {
    expect(mapsDataChanged(before, stamped([['CO', 'a2', 2], ['RI', 'b', 1]]), { base: 1, head: 2 })).toBe(true);
  });
  it('needs every changed state covered, not just one', () => {
    expect(mapsDataChanged(before, stamped([['CO', 'a2', 2], ['RI', 'b2', 1]]), { base: 2, head: 2 })).toBe(true);
  });
});

describe('newestTag', () => {
  const all = ['engine-v1.0.0', 'engine-v1.10.0', 'engine-v1.9.0', 'input-census-2020-r1', 'input-census-2020-r2', 'input-census-2020-r10', 'maps-2', 'maps-10', 'web-v1.0.0', 'nonsense', 'engine-v1.0.0-rc1'];
  it('picks the highest version of each component by numeric order', () => {
    expect(newestTag(all, 'engine')).toBe('engine-v1.10.0');
    expect(newestTag(all, 'input')).toBe('input-census-2020-r10');
    expect(newestTag(all, 'maps')).toBe('maps-10');
    expect(newestTag(all, 'web')).toBe('web-v1.0.0');
  });
  it('is null when the component has no tag', () => {
    expect(newestTag(all, 'docs')).toBeNull();
  });
});

describe('tagsFor', () => {
  it('tags every component on a root commit, with the exact baseline names', () => {
    expect(tagsFor(null, base)).toEqual(['engine-v1.0.0', 'input-census-2020-r1', 'maps-1', 'schema-v1.0.0', 'web-v1.0.0', 'docs-v1.0.0']);
  });
  it('tags only what changed', () => {
    expect(tagsFor(base, { ...base, maps: 2 })).toEqual(['maps-2']);
    expect(tagsFor(base, { ...base, input: { ...base.input, revision: 2 }, maps: 2 })).toEqual(['input-census-2020-r2', 'maps-2']);
    expect(tagsFor(base, base)).toEqual([]);
  });
  it('ignores an input sha change that kept the revision', () => {
    expect(tagsFor(base, { ...base, input: { ...base.input, sha256: 'f'.repeat(64) } })).toEqual([]);
  });
});

describe('versionProblems', () => {
  let mapsDataChanged = false;
  const check = (head: Versions, touched: Component[], changelogs = noChangelog): string[] =>
    versionProblems({ base, head, touched: new Set(touched), changelogs, mapsDataChanged });

  it('is quiet when nothing changed or when touched components are bumped', () => {
    expect(check(base, [])).toEqual([]);
    expect(check({ ...base, web: '1.0.1' }, ['web'])).toEqual([]);
  });
  it('flags changed published hashes without a maps bump', () => {
    mapsDataChanged = true;
    const problems = check(base, []);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('maps');
    expect(problems[0]).toContain('not bumped');
    expect(check({ ...base, maps: 2 }, [])).toEqual([]);
    mapsDataChanged = false;
  });
  it('flags a maps bump when the hashes did not change and neither engine nor input moved', () => {
    expect(check({ ...base, maps: 2 }, [])).toEqual(['maps: bumped in config/versions.json but the published assignment and input hashes did not change']);
  });
  it('flags a bump with no changed files', () => {
    expect(check({ ...base, docs: '1.0.1' }, [])).toEqual(['docs: bumped in config/versions.json but none of its files changed']);
  });
  it('lets maps follow an engine or input bump without changed hashes', () => {
    expect(check({ ...base, engine: '1.1.0', maps: 2 }, ['engine'])).toEqual([]);
    expect(check({ ...base, input: { ...base.input, revision: 2 }, maps: 2 }, ['input'])).toEqual([]);
  });
  it('flags an em dash in a changelog', () => {
    const problems = check(base, [], { ...noChangelog, maps: '# Maps changelog\n\n- fixed — things\n' });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('em dash');
    expect(problems[0]).toContain('changelog/maps.md');
  });
});

describe('prependEntry', () => {
  it('inserts the first entry under the title', () => {
    expect(prependEntry('# Maps changelog\n\n', '2', '2026-10-08', ['a', 'b'])).toBe('# Maps changelog\n\n## 2 (2026-10-08)\n\n- a\n- b\n');
  });
  it('puts the newest entry first', () => {
    const first = prependEntry('# Maps changelog\n\n', '2', '2026-10-08', ['a']);
    expect(prependEntry(first, '3', '2026-11-01', ['c'])).toBe('# Maps changelog\n\n## 3 (2026-11-01)\n\n- c\n\n## 2 (2026-10-08)\n\n- a\n');
  });
});

describe('compareFingerprints', () => {
  const sha = (ch: string): string => ch.repeat(64);
  const states = { RI: sha('a'), DE: sha('b') };
  const baseFile = FingerprintFileSchema.parse({ engineMajor: 1, states });
  const recorded = (engineMajor: number, s: Record<string, string>) => FingerprintFileSchema.parse({ engineMajor, states: s });

  it('passes when the drawn fingerprints equal the base', () => {
    expect(compareFingerprints(baseFile, baseFile, states, 1)).toMatchObject({ ok: true, changed: [] });
  });
  it('fails when one changed and the major did not', () => {
    const r = compareFingerprints(baseFile, baseFile, { ...states, DE: sha('c') }, 1);
    expect(r.ok).toBe(false);
    expect(r.changed).toEqual(['DE']);
    expect(r.message).toContain('DE');
  });
  it('passes when one changed, the major was bumped and the head file records the new fingerprints', () => {
    const drawn = { ...states, RI: sha('c') };
    const r = compareFingerprints(baseFile, recorded(2, drawn), drawn, 2);
    expect(r.ok).toBe(true);
    expect(r.changed).toEqual(['RI']);
  });
  it('fails when the major was bumped but the head file still holds the old fingerprints', () => {
    const drawn = { ...states, RI: sha('c') };
    expect(compareFingerprints(baseFile, baseFile, drawn, 2).ok).toBe(false);
  });
  it('fails when the head file was edited to match a changed map without a major bump', () => {
    const drawn = { ...states, RI: sha('c') };
    expect(compareFingerprints(baseFile, recorded(1, drawn), drawn, 1).ok).toBe(false);
  });
  it('fails when the head file records a different engine major than the head version', () => {
    const drawn = { ...states, RI: sha('c') };
    expect(compareFingerprints(baseFile, recorded(1, drawn), drawn, 2).ok).toBe(false);
  });
  it('treats a missing fixture state as changed', () => {
    expect(compareFingerprints(baseFile, baseFile, { RI: sha('a') }, 1).changed).toEqual(['DE']);
  });
  it('passes vacuously when the base records no states (before the cut)', () => {
    expect(compareFingerprints({ engineMajor: 1, states: {} }, baseFile, states, 1).ok).toBe(true);
  });
  it('takes the major to beat from the base versions.json, not the base fingerprint file', () => {
    const versionsAt = (engine: string): string => JSON.stringify({ ...VERSIONS, engine });
    expect(baseEngineMajor(versionsAt('2.3.1'), 1)).toBe(2);
    expect(baseEngineMajor(null, 1)).toBe(1);
    // Base released engine 2.0.0 but its fingerprint file still says major 1. A pull request changes the output and
    // re-records major 2 without bumping versions.json: the major to beat is 2, so it fails.
    const stale = FingerprintFileSchema.parse({ engineMajor: 1, states });
    const drawn = { ...states, RI: sha('c') };
    const head = recorded(2, drawn);
    const baseMajor = baseEngineMajor(versionsAt('2.0.0'), stale.engineMajor);
    expect(compareFingerprints({ ...stale, engineMajor: baseMajor }, head, drawn, 2).ok).toBe(false);
    // Judged by the stale file's own major, the same pull request would have passed.
    expect(compareFingerprints(stale, head, drawn, 2).ok).toBe(true);
    // A real bump to 3 passes.
    expect(compareFingerprints({ ...stale, engineMajor: baseMajor }, recorded(3, drawn), drawn, 3).ok).toBe(true);
  });
  it('reads the checked-in fingerprint file', () => {
    expect(FingerprintFileSchema.parse(JSON.parse(readFileSync('tests/fingerprints/engine.json', 'utf8')))).toEqual({ engineMajor: 1, states: {} });
  });
});

describe('changelog files', () => {
  it('exist for every component, titled, with no em dash', () => {
    for (const c of COMPONENTS) {
      const text = readFileSync(`changelog/${c}.md`, 'utf8');
      expect(text.startsWith('# ')).toBe(true);
      expect(text).not.toContain('—');
    }
  });
});
