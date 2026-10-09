import type { VersionStamp } from '../../shared/config/index.js';
import { DataError } from '../../shared/errors/index.js';

const engineMajor = (engine: string): string => engine.split('.')[0] ?? engine;

const sameStamp = (a: VersionStamp, b: VersionStamp): boolean =>
  a.engine === b.engine && a.maps === b.maps && a.schema === b.schema && a.input.vintage === b.input.vintage && a.input.revision === b.input.revision && a.input.sha256 === b.input.sha256;

/**
 * Refuses to replace a published map with a different one under the same engine major and input revision.
 * A map may only change when the engine major or the input revision moves (npm run release does both). `baseline`
 * skips the check for unstamped states only, for the one-time stamping of data published before versioning existed.
 */
export function checkPublishGate(
  existing: { versions?: VersionStamp; sha: string } | null,
  next: { versions: VersionStamp; sha: string },
  baseline: boolean,
  state = 'state',
): void {
  // --baseline only stamps data published before versioning; a state that already carries a stamp is still gated.
  if (existing === null || (baseline && existing.versions === undefined)) return;
  if (existing.versions === undefined) {
    throw new DataError(`${state}: published data has no version stamp; run publish-data --baseline once`);
  }
  if (engineMajor(existing.versions.engine) === engineMajor(next.versions.engine) && existing.versions.input.revision === next.versions.input.revision && existing.sha !== next.sha) {
    throw new DataError(`${state}: the map changed but the engine major and input revision did not; bump the engine major (npm run release)`);
  }
}

/**
 * The published states whose stamp is not the current one. The dataset-wide versions file may only move to the
 * current versions when this is empty; after a partial publish it would otherwise name a release some maps were not drawn under.
 */
export function staleStamps(published: readonly { abbr: string; versions?: VersionStamp }[], current: VersionStamp): string[] {
  return published.filter((p) => p.versions === undefined || !sameStamp(p.versions, current)).map((p) => p.abbr);
}
