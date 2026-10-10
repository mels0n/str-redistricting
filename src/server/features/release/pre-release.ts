import { COMPONENTS, ReleaseConfigSchema, type ReleaseConfig } from './components.js';
import { newestTag } from './tags.js';

/**
 * True before the 1.0 cut: the config does not enforce yet and no component has a release tag. The publish gate and
 * the fixture gate stand aside in this window, because there is no released map to protect.
 */
export function isPreRelease(releaseConfig: ReleaseConfig, tags: readonly string[]): boolean {
  return !releaseConfig.enforce && COMPONENTS.every((c) => newestTag(tags, c) === null);
}

/**
 * Pre-release as the base ref sees it: the gate is judged by the branch being merged into, so a pull request cannot
 * switch it off by editing its own config/release.json. A base without the file counts as not enforcing. `headRelease`
 * only fills the other fields when the base has no file.
 */
export function preReleaseForBase(baseReleaseText: string | null, headRelease: ReleaseConfig, tags: readonly string[]): boolean {
  const base = baseReleaseText === null ? { ...headRelease, enforce: false } : ReleaseConfigSchema.parse(JSON.parse(baseReleaseText));
  return isPreRelease(base, tags);
}
