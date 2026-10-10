import { COMPONENTS, type ReleaseConfig } from './components.js';
import { newestTag } from './tags.js';

/**
 * True before the 1.0 cut: the config does not enforce yet and no component has a release tag. The publish gate and
 * the fixture gate stand aside in this window, because there is no released map to protect.
 */
export function isPreRelease(releaseConfig: ReleaseConfig, tags: readonly string[]): boolean {
  return !releaseConfig.enforce && COMPONENTS.every((c) => newestTag(tags, c) === null);
}
