import type { VersionStamp } from '../../shared/config/index.js';
import { DataError } from '../../shared/errors/index.js';

const engineMajor = (engine: string): string => engine.split('.')[0] ?? engine;

/**
 * Refuses to replace a published map with a different one under the same engine major and input revision.
 * A map may only change when the engine major or the input revision moves (npm run release does both). `baseline`
 * skips the check for the one-time stamping of data published before versioning existed.
 */
export function checkPublishGate(
  existing: { versions?: VersionStamp; sha: string } | null,
  next: { versions: VersionStamp; sha: string },
  baseline: boolean,
  state = 'state',
): void {
  if (existing === null || baseline) return;
  if (existing.versions === undefined) {
    throw new DataError(`${state}: published data has no version stamp; run publish-data --baseline once`);
  }
  if (engineMajor(existing.versions.engine) === engineMajor(next.versions.engine) && existing.versions.input.revision === next.versions.input.revision && existing.sha !== next.sha) {
    throw new DataError(`${state}: the map changed but the engine major and input revision did not; bump the engine major (npm run release)`);
  }
}
