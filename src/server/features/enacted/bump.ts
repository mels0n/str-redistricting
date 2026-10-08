import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EnactedConfigSchema, ManifestSchema, parseEnactedFileName, type EnactedConfig } from '../../shared/config/index.js';
import { ConfigError, DataError } from '../../shared/errors/index.js';

export const ENACTED_JSON = 'enacted.json';
export const MANIFEST_JSON = 'census-sha256.json';

/** At most this many vintages are kept as candidates, newest first. */
const MAX_CANDIDATES = 2;
const ENACTED_ZIP = /^cb_\d{4}_us_cd\d+_500k\.zip$/;

export interface BumpPlan {
  readonly config: EnactedConfig;
  readonly manifest: Record<string, string>;
}

/**
 * The enacted config and manifest after adopting `file` (whose archive hashes to `sha256`). The new file becomes the
 * first candidate; the previous vintages stay as fallbacks only while they are of the same Congress. Manifest entries
 * for enacted files that are no longer candidates are dropped; every other entry is left as it is.
 */
export function planBump(current: EnactedConfig, manifest: Readonly<Record<string, string>>, file: string, sha256: string): BumpPlan {
  const next = parseEnactedFileName(file);
  const now = parseEnactedFileName(current.file);
  if (next === null) throw new ConfigError(`${file} is not an enacted-districts file name (expected cb_<year>_us_cd<congress>_500k)`);
  if (now === null) throw new DataError(`config/${ENACTED_JSON}: ${current.file} is not an enacted-districts file name`);
  if (next.congress < now.congress || (next.congress === now.congress && next.year < now.year)) {
    throw new ConfigError(`${file} is older than the pinned ${current.file}`);
  }
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new ConfigError('sha256 must be 64 lowercase hex characters');
  const zip = `${file}.zip`;
  if (Object.hasOwn(manifest, zip) && manifest[zip] !== sha256) {
    throw new DataError(`${zip} is already pinned to a different hash; the Census Bureau reissued it, which would change the maps`);
  }

  const kept = next.congress === now.congress ? current.candidates.filter((c) => c !== file) : [];
  const candidates = [file, ...kept].slice(0, MAX_CANDIDATES);
  const config = EnactedConfigSchema.parse({ congress: next.congress, file, candidates });

  const out: Record<string, string> = {};
  for (const [name, hash] of Object.entries(manifest)) {
    if (ENACTED_ZIP.test(name) && !candidates.includes(name.slice(0, -'.zip'.length))) continue;
    out[name] = hash;
  }
  out[zip] = sha256;
  return { config, manifest: Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) };
}

/** The exact layout of config/enacted.json, so a bump changes only the lines whose values changed. */
export const formatEnacted = (c: EnactedConfig): string =>
  `{\n  "congress": ${c.congress},\n  "file": ${JSON.stringify(c.file)},\n  "candidates": [${c.candidates.map((x) => JSON.stringify(x)).join(', ')}]\n}\n`;

export const formatManifest = (m: Readonly<Record<string, string>>): string => `${JSON.stringify(m, null, 2)}\n`;

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch {
    throw new DataError(`${path}: could not be read as JSON`);
  }
}

/** Read both config files from `configDir`, adopt `file`, and write them back. Returns the plan that was written. */
export async function applyBump(configDir: string, file: string, sha256: string): Promise<BumpPlan> {
  const enactedPath = join(configDir, ENACTED_JSON);
  const manifestPath = join(configDir, MANIFEST_JSON);
  const current = EnactedConfigSchema.safeParse(await readJson(enactedPath));
  if (!current.success) throw new DataError(`${enactedPath}: ${current.error.issues.map((i) => i.message).join('; ')}`);
  const manifest = ManifestSchema.safeParse(await readJson(manifestPath));
  if (!manifest.success) throw new DataError(`${manifestPath}: ${manifest.error.issues.map((i) => i.message).join('; ')}`);
  const plan = planBump(current.data, manifest.data, file, sha256);
  await writeFile(manifestPath, formatManifest(plan.manifest));
  await writeFile(enactedPath, formatEnacted(plan.config));
  return plan;
}
