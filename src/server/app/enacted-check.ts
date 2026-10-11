import { describeFile, detectLegislativeSafely, detectUpdate } from '../features/enacted/index.js';
import { boundaryUrl } from '../features/publish/index.js';
import { ENACTED_CONFIG } from '../shared/config/index.js';
import { ConfigError, exitCodeFor } from '../shared/errors/index.js';

// Prints one JSON line on stdout: {"update":false,"legislative":{...}}, or {"update":true,"file":...,"congress":...,"year":...,"url":...,"legislative":{...}}.
// `legislative` is {"update":bool,"vintage":N}: whether the next State House and State Senate vintage is served, and
// the vintage to adopt (the pinned one when there is nothing new). When that probe fails it is
// {"update":false,"vintage":N,"error":"probe failed"} and the congressional result stands.
// With `--file <name>` it skips the probe and reports that file instead (the workflow's manual override); the
// legislative vintage is not probed then.
const args = process.argv.slice(2);
const forced = args[0] === '--file' ? args[1] : undefined;
if (args.length > 0 && (forced === undefined || args.length !== 2)) {
  const usage = new ConfigError('usage: enacted:check [--file <cb_YYYY_us_cdNNN_500k>]');
  console.error(usage.message);
  process.exit(exitCodeFor(usage));
}
(async () => {
  if (forced !== undefined) return { ...describeFile(forced, boundaryUrl), legislative: { update: false, vintage: ENACTED_CONFIG.legislative.vintage } };
  const congressional = await detectUpdate(ENACTED_CONFIG, new Date().getUTCFullYear(), boundaryUrl);
  return { ...congressional, legislative: await detectLegislativeSafely(ENACTED_CONFIG) };
})()
  .then((result) => {
    console.log(JSON.stringify(result));
  })
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(exitCodeFor(err));
  });
