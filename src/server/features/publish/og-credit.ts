import type { VersionStamp } from '../../shared/config/index.js';
import { SITE_HOST } from './site.js';

/**
 * The line printed on a state's link preview image: where the map lives, which state, which maps release
 * and engine drew it, and the first 8 characters of the finished plan's fingerprint.
 */
export function ogCredit(p: { abbr: string; name: string; versions: VersionStamp; assignmentSha256: string }): string {
  return [`${SITE_HOST}/${p.abbr}`, p.name, `Maps release ${p.versions.maps}`, `engine ${p.versions.engine}`, p.assignmentSha256.slice(0, 8)].join(' · ');
}
