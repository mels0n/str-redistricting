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
    expect(reproduceCommands('CO').split('\n')).toEqual([`git clone ${REPO}`, 'cd str-redistricting', 'npm install', 'npm run explore -- --states CO']);
  });

  it('links the repository from the state’s proof panel', () => {
    const p = createProofPanel();
    p.update({ metrics, plan: 'finished', abbr: 'CO' });
    const link = p.el.querySelector<HTMLAnchorElement>('.strv-proof__recipe a');
    expect(link?.getAttribute('href')).toBe(REPO);
    expect(p.el.querySelector('.strv-proof__recipe code')?.textContent).toBe(reproduceCommands('CO'));
  });
});
