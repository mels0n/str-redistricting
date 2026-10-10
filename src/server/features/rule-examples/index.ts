import type { RuleExamplesConfig } from '../../shared/config/index.js';
import { fingerprintCase, idealCase, shareCase } from './cases/data.js';
import { createExtractContext, type ExtractContext } from './context.js';
import type { RuleCase } from './schema.js';
import { writeRuleExamples } from './write.js';

export type CaseBuilder = (ctx: ExtractContext) => Promise<RuleCase>;

/** The cases that need only a state's generated output files (no geometry). */
export const dataCases: readonly CaseBuilder[] = [shareCase, idealCase, fingerprintCase];

/** Build every given case from the generated plans and write the examples file; returns case count and bytes. */
export async function extractRuleExamples(cfg: RuleExamplesConfig, builders: readonly CaseBuilder[]): Promise<{ cases: number; bytes: number }> {
  const ctx = createExtractContext(cfg);
  const cases: RuleCase[] = [];
  for (const build of builders) cases.push(await build(ctx));
  const bytes = await writeRuleExamples(cfg.dest, cases);
  return { cases: cases.length, bytes };
}

export { createExtractContext } from './context.js';
export { nameOf, whole } from './cases/data.js';
export type { ExtractContext, StateBlocks } from './context.js';
export { chosenCandidate, generatedStates, loadCandidates, loadCutStats, loadMetricsIfPresent, loadStateOutput, numberField, pieceMembers, withLowSeats } from './load.js';
export type { StateOutput } from './load.js';
export type { BalanceLog, Candidates, CutStats, PlanMetrics } from '../../entities/plan-output/index.js';
export { RuleCaseSchema, RuleExamplesSchema } from './schema.js';
export type { RuleCase, RuleExamples } from './schema.js';
export { projectWindow, simplifyRing } from './window.js';
export { MAX_BYTES, writeRuleExamples } from './write.js';
