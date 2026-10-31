import { describe, expect, it } from 'vitest';
import { ReleaseConfigSchema, componentsFor, componentsOfFile, parseCommitSubject, type Commit, type ReleaseConfig } from '../../../src/server/features/release/index.js';
import { DataError } from '../../../src/server/shared/errors/index.js';

const globs: ReleaseConfig = ReleaseConfigSchema.parse({
  enforce: true,
  paths: { engine: ['src/server/**'], input: [], maps: [], schema: [], web: [], docs: [] },
  exclude: { engine: ['src/server/app/notes.ts'], input: [], maps: [], schema: [], web: [], docs: [] },
  ignore: ['tests/**', 'src/server/app/cli.ts'],
  docsTypes: ['docs'],
  fixtureStates: ['VT'],
});
const graph: ReleaseConfig = { ...globs, engineEntries: ['src/server/app/cli.ts'] };
const head = new Set(['src/server/app/cli.ts', 'src/server/features/draw/index.ts', 'src/server/features/draw/cut.ts']);
// The base graph also reached features/old, which HEAD deleted; version-check unions the two.
const union = new Set([...head, 'src/server/features/old/index.ts']);
const commit = (subject: string, files: string[]): Commit => ({ sha: 'a', subject, ...parseCommitSubject(subject), files });

describe('engine classification by import graph', () => {
  it('counts a file in the graph as engine', () => {
    expect(componentsOfFile('src/server/features/draw/cut.ts', graph, head)).toEqual(['engine']);
  });
  it('does not count a server file the generator does not import, with no exception list', () => {
    expect(componentsOfFile('src/server/app/report.ts', graph, head)).toEqual([]);
    expect(componentsOfFile('src/server/app/brand-new.ts', graph, head)).toEqual([]);
  });
  it('lets ignore win over the graph', () => {
    expect(componentsOfFile('src/server/app/cli.ts', graph, head)).toEqual([]);
  });
  it('counts a file deleted at HEAD that the base graph imported', () => {
    expect(componentsOfFile('src/server/features/old/index.ts', graph, head)).toEqual([]);
    expect(componentsOfFile('src/server/features/old/index.ts', graph, union)).toEqual(['engine']);
    expect([...componentsFor(commit('refactor: drop old', ['src/server/features/old/index.ts']), graph, union)]).toEqual(['engine']);
  });
  it('uses the globs and their exclusions when engineEntries is absent', () => {
    expect(componentsOfFile('src/server/app/report.ts', globs)).toEqual(['engine']);
    expect(componentsOfFile('src/server/app/notes.ts', globs)).toEqual([]);
    expect(componentsOfFile('src/server/app/report.ts', globs, head)).toEqual(['engine']);
  });
  it('refuses to guess when engineEntries is set and no file set is given', () => {
    expect(() => componentsOfFile('src/server/app/report.ts', graph)).toThrow(DataError);
  });
});
