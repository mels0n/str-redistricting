import { dataCases, extractRuleExamples } from '../features/rule-examples/index.js';
import { parseRuleExamplesConfig } from '../shared/config/index.js';
import { exitCodeFor } from '../shared/errors/index.js';

extractRuleExamples(parseRuleExamplesConfig(process.argv.slice(2)), [...dataCases])
  .then(({ cases, bytes }) => console.log(`wrote ${cases} cases, ${bytes} bytes`))
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(exitCodeFor(err));
  });
