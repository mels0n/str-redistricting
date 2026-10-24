import { spawnSync } from 'node:child_process';

/**
 * Builds the site once, before any test file runs, so the suites that read dist/ (prerender, hosting routes) never
 * race two builds into one directory when vitest runs files in parallel workers. The build is always fresh, so no test
 * reads a stale dist/. Cost: it also runs when a single file is run, even one that never reads dist/.
 */
export default function setup(): void {
  const run = spawnSync('npm run build', { shell: true, encoding: 'utf8' });
  if (run.status !== 0) {
    throw new Error(`npm run build failed (exit ${run.status})\n${run.stdout}\n${run.stderr}`);
  }
}
