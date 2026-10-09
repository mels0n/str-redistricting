import { createHash } from 'node:crypto';
import { z } from 'zod';
import versionsJson from '../../../../config/versions.json' with { type: 'json' };

/**
 * The version of every independently versioned component (config/versions.json). The release script rewrites it; the
 * generator stamps the engine, input, maps and schema parts into the published data; the viewer reads the same file.
 */
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const Semver = z.string().regex(SEMVER, 'must be a semantic version like 1.0.0');

export const VersionsSchema = z.strictObject({
  engine: Semver,
  input: z.strictObject({
    /** The census the block data comes from, e.g. census-2020. */
    vintage: z.string().regex(/^census-\d{4}$/, 'must look like census-2020'),
    /** Counts every change to the pinned input files within a vintage. */
    revision: z.number().int().min(1),
    /** Fingerprint of config/census-sha256.json and config/enacted.json (see inputSha256Of). */
    sha256: z.string().regex(/^[0-9a-f]{64}$/, 'must be 64 lowercase hex characters'),
  }),
  maps: z.number().int().min(1),
  schema: Semver,
  web: Semver,
  docs: Semver,
});

export type Versions = z.infer<typeof VersionsSchema>;

/** What the published data carries: the parts that change the data, not the site or the docs. */
export interface VersionStamp {
  engine: string;
  input: { vintage: string; revision: number; sha256: string };
  maps: number;
  schema: string;
}

/** Validated once, at boot. */
export const VERSIONS: Versions = VersionsSchema.parse(versionsJson);

export function stampOf(v: Versions): VersionStamp {
  return { engine: v.engine, input: { ...v.input }, maps: v.maps, schema: v.schema };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = sortKeys((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

/**
 * sha256 of the two input files, independent of whitespace: the census manifest with its keys sorted, and the enacted
 * config as written.
 */
export function inputSha256Of(censusManifestText: string, enactedText: string): string {
  const census = sortKeys(JSON.parse(censusManifestText));
  const enacted: unknown = JSON.parse(enactedText);
  return createHash('sha256').update(JSON.stringify({ census, enacted })).digest('hex');
}

export function formatVersions(v: Versions): string {
  return `${JSON.stringify(v, null, 2)}\n`;
}
