// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createProofPanel } from '../../src/client/widgets/proof-panel';
import { config, reproduceCommands } from '../../src/client/shared';
import type { Metrics } from '../../src/client/entities/plan';

const REPO = 'https://github.com/mels0n/str-redistricting';

const metrics = {
  state: 'CO', angleStepDeg: 0.1, inputSha256: 'a'.repeat(64), seats: 8, population: 5773714, ideal: 721714, rangePersons: 1, rangePct: 0,
  allContiguous: true, assignmentSha256: 'b'.repeat(64), balanceMoves: 3, peopleMovedByBalancing: 40, rangeBeforeBalancing: 90, rangeAfterBalancing: 1,
  cuts: 7, angleCount: 1800, candidateLinesEvaluated: 0, strayBlocksMoved: 0, strayPopMoved: 0, recounts: 0, recountsMaxPerCut: 0, runtimeMs: 1000,
  countiesSplit: 0, countiesTotal: 64, blocks: 140000,
} as unknown as Metrics;

describe('reproducing a map', () => {
  it('points at the public repository', () => {
    expect(config.repoUrl).toBe(REPO);
  });

  it('starts the recipe from a fresh clone', () => {
    expect(reproduceCommands('CO', null).split('\n')).toEqual([`git clone ${REPO}`, 'cd str-redistricting', 'npm install', 'npm run explore -- --states CO']);
  });

  it('links the repository from the state’s proof panel', () => {
    const p = createProofPanel();
    p.update({ metrics, plan: 'finished', abbr: 'CO' });
    const link = p.el.querySelector<HTMLAnchorElement>('.strv-proof__recipe a');
    expect(link?.getAttribute('href')).toBe(REPO);
    expect(p.el.querySelector('.strv-proof__recipe code')?.textContent).toBe(reproduceCommands('CO', null));
  });

  it('pins the clone to the maps release when one is known', () => {
    expect(reproduceCommands('CO', 3).split('\n')).toEqual([`git clone --branch maps-3 --depth 1 ${REPO}`, 'cd str-redistricting', 'npm install', 'npm run explore -- --states CO']);
  });

  describe('proof panel version rows', () => {
    const stamp = { engine: '1.0.0', input: { vintage: 'census-2020', revision: 1, sha256: 'c'.repeat(64) }, maps: 1, schema: '1.0.0' };

    it('shows the engine, the maps release and the pinned recipe from a stamp', () => {
      const p = createProofPanel();
      p.update({ metrics, plan: 'finished', abbr: 'CO', versions: stamp });
      const text = p.el.textContent ?? '';
      expect(text).toContain('Engine');
      expect(text).toContain('The version of the code that drew this map.');
      expect(text).toContain('Maps release');
      expect(text).toContain('Every map in this release was drawn by the same code from the same Census files.');
      expect(text).toContain('SHA-256 of the 2020 Census block file the map was drawn from (2020 Census, revision 1).');
      expect(text).toContain('The same code release and the same Census files give a byte-identical map with the same fingerprint, on any computer. No random numbers are used.');
      expect(p.el.querySelector('.strv-proof__recipe code')?.textContent).toBe(reproduceCommands('CO', 1));
      expect(p.el.querySelector('.strv-proof__recipe code')?.textContent).toContain('--branch maps-1');
    });

    it('shows no version rows and the plain clone for unstamped data', () => {
      const p = createProofPanel();
      p.update({ metrics, plan: 'finished', abbr: 'CO' });
      const text = p.el.textContent ?? '';
      expect(text).not.toContain('Maps release');
      expect(text).not.toContain('The version of the code that drew this map.');
      expect(text).toContain('SHA-256 of the 2020 Census block file the map was drawn from.');
      expect(p.el.querySelector('.strv-proof__recipe code')?.textContent).toBe(reproduceCommands('CO', null));
    });
  });
});
