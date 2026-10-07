import type { RuleExamplesConfig } from '../../shared/config/index.js';
import { fingerprintCase, idealCase, shareCase } from './cases/data.js';
import { createExtractContext, type ExtractContext } from './context.js';
import type { RuleCase } from './schema.js';
import { writeRuleExamples } from './write.js';

export type CaseBuilder = (ctx: ExtractContext) => Promise<RuleCase>;

/** Every registered case; later cases are added here. */
export const CASES: readonly CaseBuilder[] = [shareCase, idealCase, fingerprintCase];

/** Build every case from the generated plans and write the examples file; returns case count and bytes. */
export async function extractRuleExamples(cfg: RuleExamplesConfig): Promise<{ cases: number; bytes: number }> {
  const ctx = createExtractContext(cfg);
  const cases: RuleCase[] = [];
  for (const build of CASES) cases.push(await build(ctx));
  const bytes = await writeRuleExamples(cfg.dest, cases);
  return { cases: cases.length, bytes };
}

export { createExtractContext } from './context.js';
export type { ExtractContext, StateBlocks } from './context.js';
export { loadStateOutput, pieceMembers } from './load.js';
export type { StateOutput } from './load.js';
export { RuleCaseSchema, RuleExamplesSchema } from './schema.js';
export type { RuleCase, RuleExamples } from './schema.js';
export { projectWindow } from './window.js';
export { MAX_BYTES, writeRuleExamples } from './write.js';
