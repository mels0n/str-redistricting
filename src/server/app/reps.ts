import { mkdir } from 'node:fs/promises';
import { pinRepsSources, publishReps } from '../features/reps/index.js';
import { parseRepsConfig } from '../shared/config/reps.js';
import { exitCodeFor } from '../shared/errors/index.js';

// `reps:pin` downloads the congress-legislators files and every state's Open States CSV, keeps them in the cache
// and writes their hashes to config/reps-sources.json. `reps:publish` checks the files against those hashes, then
// writes public/data/reps/<ST>.json and coverage.json.

async function main(): Promise<void> {
  const cfg = parseRepsConfig(process.argv.slice(2));
  await mkdir(cfg.cacheDir, { recursive: true });
  if (cfg.mode === 'pin') {
    console.log(`pinned ${await pinRepsSources(cfg.configDir, cfg.cacheDir)} files`);
    return;
  }
  const { coverage } = await publishReps(cfg);
  let matched = 0;
  for (const [state, chambers] of Object.entries(coverage)) {
    if (chambers['us-house'] !== undefined) console.log(`${state} us-house: vacant ${chambers['us-house'].vacant.join(', ')}`);
    for (const chamber of ['state-house', 'state-senate'] as const) {
      const c = chambers[chamber];
      if (c === undefined) continue;
      matched += c.matched;
      if (c.unmatched.length > 0) console.log(`${state} ${chamber}: unmatched ${c.unmatched.join(', ')}`);
    }
  }
  console.log(`wrote ${Object.keys(coverage).length} state files and coverage.json (${matched} state districts matched)`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'reps failed');
  process.exit(exitCodeFor(err));
});
