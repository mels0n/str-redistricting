import { z } from 'zod';
import releaseJson from '../../../../config/release.json' with { type: 'json' };

/**
 * Whether the version rules are enforced (config/release.json `enforce`). Until the 1.0 release is cut they are
 * not: version checks warn instead of failing, and publish-data may replace a map without an engine major bump.
 */
export const VERSIONS_ENFORCED: boolean = z.object({ enforce: z.boolean() }).parse(releaseJson).enforce;
