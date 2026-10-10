import { engineMajor, type VersionStamp } from '../../shared/config/index.js';
import { DataError } from '../../shared/errors/index.js';

const sameStamp = (a: VersionStamp, b: VersionStamp): boolean =>
  a.engine === b.engine && a.maps === b.maps && a.schema === b.schema && a.input.vintage === b.input.vintage && a.input.revision === b.input.revision && a.input.sha256 === b.input.sha256;

/** What the gate knows about one state's map: both plans' fingerprints and the census file the plans were drawn from. */
export interface PublishedPlan {
  readonly versions?: VersionStamp;
  /** assignmentSha256 of the finished plan. */
  readonly sha: string;
  /** assignmentSha256 of the before-balancing plan; undefined when the published stats do not record it. */
  readonly beforeSha?: string | undefined;
  /** The state's census input sha256 recorded with the plan. */
  readonly inputSha256: string;
}

/**
 * Refuses to replace a published map with a different one unless the engine major moved or the census input changed
 * (a new vintage, or a different pinned census file for the state). "The map" is both the finished and the
 * before-balancing assignment, so a change the balancing step absorbs still counts. A change to the enacted districts
 * alone moves the input revision but never reopens the gate: it cannot change an assignment. The release script
 * records the bump; the gate accepts either an engine major or a census change. `baseline` skips the check for
 * unstamped states only, for the one-time stamping of data published before versioning existed. While the version
 * rules are not enforced (config/release.json, before the 1.0 release) a changed map under the same engine major is
 * allowed and the returned warning says so; once they are enforced it is refused.
 */
export function checkPublishGate(
  existing: PublishedPlan | null,
  next: PublishedPlan & { versions: VersionStamp },
  baseline: boolean,
  state = 'state',
  enforced = true,
): string | undefined {
  // --baseline only stamps data published before versioning; a state that already carries a stamp is still gated.
  if (existing === null || (baseline && existing.versions === undefined)) return;
  if (existing.versions === undefined) {
    throw new DataError(`${state}: published data has no version stamp; run publish-data --baseline once`);
  }
  const beforeChanged = existing.beforeSha !== undefined && next.beforeSha !== undefined && existing.beforeSha !== next.beforeSha;
  if (existing.sha === next.sha && !beforeChanged) return;
  const engineMoved = engineMajor(existing.versions.engine) !== engineMajor(next.versions.engine);
  const censusMoved = existing.versions.input.vintage !== next.versions.input.vintage || existing.inputSha256 !== next.inputSha256;
  if (!engineMoved && !censusMoved) {
    const message = `${state}: the map changed but the engine major and the census input did not; bump the engine major (npm run release)`;
    if (enforced) throw new DataError(message);
    return `${message} (allowed: version rules are not enforced before the 1.0 release)`;
  }
  return undefined;
}

/**
 * The published states whose stamp is not the current one. The dataset-wide versions file may only move to the
 * current versions when this is empty; after a partial publish it would otherwise name a release some maps were not drawn under.
 */
export function staleStamps(published: readonly { abbr: string; versions?: VersionStamp }[], current: VersionStamp): string[] {
  return published.filter((p) => p.versions === undefined || !sameStamp(p.versions, current)).map((p) => p.abbr);
}
