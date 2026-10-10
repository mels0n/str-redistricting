import type { PlanMetrics } from '../../entities/plan-output/index.js';
import { engineMajor } from '../../shared/config/index.js';
import { DataError } from '../../shared/errors/index.js';

/** What a plan must have been drawn with to be published under the current code and pinned inputs. */
export interface PlanExpectation {
  /** The current engine version; only its major must match (patch and minor never change a map). */
  readonly engine: string;
  /** The pinned sha256 of the state's census block file. */
  readonly inputSha256: string;
  /** How the cut search chose among straight lines (config LINE_SEARCH). */
  readonly lineSearch: string;
}

/**
 * Refuses a plan that was not drawn by the current engine major from the pinned census file with the current line
 * search. `label` names the plan for the message (for example "CO" or "CO before-balancing").
 */
export function checkPlanProvenance(plan: PlanMetrics, abbr: string, label: string, expected: PlanExpectation): void {
  const problems: string[] = [];
  if (plan.engine === undefined) problems.push('it records no engine version');
  else if (engineMajor(plan.engine) !== engineMajor(expected.engine)) problems.push(`it was drawn by engine ${plan.engine} and the current engine is ${expected.engine} (different major)`);
  if (plan.inputSha256 !== expected.inputSha256) problems.push('its census input sha256 is not the pinned one');
  if (plan.lineSearch !== expected.lineSearch) problems.push(`its line search is ${plan.lineSearch} and the published search is ${expected.lineSearch}`);
  if (problems.length > 0) {
    throw new DataError(`${label}: the plan cannot be published, ${problems.join('; ')}; re-run \`npm run explore -- --states ${abbr}\``);
  }
}
