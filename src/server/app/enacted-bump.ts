import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyBump, checkArchive } from '../features/enacted/index.js';
import { boundaryUrl } from '../features/publish/index.js';
import { parseEnactedBumpConfig, type EnactedBumpConfig } from '../shared/config/index.js';
import { DataError, exitCodeFor } from '../shared/errors/index.js';
import { downloadForPinning } from '../shared/http/index.js';

async function bump(cfg: EnactedBumpConfig): Promise<void> {
  const { path, sha256 } = await downloadForPinning(boundaryUrl(cfg.file), join(cfg.cacheDir, `${cfg.file}.zip`), cfg.file);
  await checkArchive(path, cfg.file);
  const plan = await applyBump(cfg.configDir, cfg.file, sha256);
  console.log(`adopted ${plan.config.file} (Congress ${plan.config.congress}), sha256 ${sha256}`);
  if (cfg.skipPublish) return;

  // A fresh process, so the publisher reads the config that was just written.
  const publish = fileURLToPath(new URL('./publish.ts', import.meta.url));
  const run = spawnSync(
    process.execPath,
    ['--max-old-space-size=8192', '--import', 'tsx', publish, '--enacted-only', '--cache-dir', cfg.cacheDir, '--public-dir', cfg.publicDir],
    { stdio: 'inherit' },
  );
  if (run.status !== 0) throw new DataError(`publish-data --enacted-only failed (exit ${String(run.status)})`);
}

try {
  await bump(parseEnactedBumpConfig(process.argv.slice(2)));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(exitCodeFor(err));
}
