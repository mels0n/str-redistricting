import { describeFile, detectUpdate } from '../features/enacted/index.js';
import { boundaryUrl } from '../features/publish/index.js';
import { ENACTED_CONFIG } from '../shared/config/index.js';
import { ConfigError, exitCodeFor } from '../shared/errors/index.js';

// Prints one JSON line on stdout: {"update":false}, or {"update":true,"file":...,"congress":...,"year":...,"url":...}.
// With `--file <name>` it skips the probe and reports that file instead (the workflow's manual override).
const args = process.argv.slice(2);
const forced = args[0] === '--file' ? args[1] : undefined;
if (args.length > 0 && (forced === undefined || args.length !== 2)) {
  const usage = new ConfigError('usage: enacted:check [--file <cb_YYYY_us_cdNNN_500k>]');
  console.error(usage.message);
  process.exit(exitCodeFor(usage));
}
(async () => (forced === undefined ? detectUpdate(ENACTED_CONFIG, new Date().getUTCFullYear(), boundaryUrl) : describeFile(forced, boundaryUrl)))()
  .then((result) => {
    console.log(JSON.stringify(result));
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(exitCodeFor(err));
  });
