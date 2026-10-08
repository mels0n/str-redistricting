import { dataUrl, fetchJson } from '../../shared';
import { RuleExamplesSchema, type RuleCase } from './model';

let pending: Promise<ReadonlyMap<string, RuleCase>> | null = null;

/** Every case in the published file, by id. One request is shared; a failed one is forgotten so a retry fetches again. */
export function loadRuleExamples(): Promise<ReadonlyMap<string, RuleCase>> {
  if (!pending) {
    const request = fetchJson(dataUrl('how/rule-examples.json'), RuleExamplesSchema).then(
      (file): ReadonlyMap<string, RuleCase> => new Map(file.cases.map((c) => [c.id, c])),
    );
    request.catch(() => {
      if (pending === request) pending = null;
    });
    pending = request;
  }
  return pending;
}
