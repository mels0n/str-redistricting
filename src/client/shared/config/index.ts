import { z } from 'zod';
import enactedJson from '../../../../config/enacted.json';
import versionsJson from '../../../../config/versions.json';

/**
 * The one configuration module for the viewer. It is read once, at boot, and
 * validated. A host page that embeds the viewer may set
 * `window.STR_VIEWER_CONFIG = { dataBase: 'https://…/data/' }` before the
 * script loads; everything else is fixed.
 */
const ConfigSchema = z.object({
  /** Base URL of the published map data (index.json, states.topo.json, <ST>/…). */
  dataBase: z.string().min(1),
  /** U.S. Census Bureau geocoder, one-line address endpoint. */
  geocoderUrl: z.url(),
  geocoderBenchmark: z.string().min(1),
  /** Geography vintage and layers, so the answer names the address's census block. */
  geocoderVintage: z.string().min(1),
  geocoderLayers: z.string().min(1),
  geocoderTimeoutMs: z.number().int().positive(),
  /** Milliseconds between cuts when the cut sequence plays. */
  cutPlayIntervalMs: z.number().int().positive(),
  /** Duration of the drawing of one cut, when motion is allowed. */
  cutDrawMs: z.number().int().nonnegative(),
  /** Milliseconds between balancing moves for a short log. */
  movePlayIntervalMs: z.number().int().positive(),
  /** A long log speeds up so the whole balancing plays in about this long. */
  movePlayTotalMs: z.number().int().positive(),
  /** The fastest the balancing ever plays, per move. */
  movePlayMinMs: z.number().int().positive(),
  /** The public source repository: the generator, the viewer and the published data. */
  repoUrl: z.url(),
  /** The public host the site is served from; named on the maps' credit strip. */
  siteHost: z.string().min(1),
});

const EnactedSchema = z.looseObject({ congress: z.number().int().positive(), file: z.string().min(1) });
const enacted = EnactedSchema.parse(enactedJson);

/**
 * The Congress whose districts the viewer shows for comparison, and the Census file they come from. Read from
 * config/enacted.json, the same file the publisher reads, so the two cannot drift; `npm run enacted:bump` rewrites
 * it, and a test checks the published data against it.
 */
export const ENACTED = { congress: enacted.congress, file: enacted.file } as const;

const VersionsSchema = z.looseObject({
  engine: z.string().min(1),
  input: z.looseObject({ vintage: z.string().min(1), revision: z.number().int().positive(), sha256: z.string().min(1) }),
  maps: z.number().int().positive(),
  schema: z.string().min(1),
  web: z.string().min(1),
  docs: z.string().min(1),
});

/** The version of every component of the site and its data, read from config/versions.json (the file the release script writes). */
export const VERSIONS = VersionsSchema.parse(versionsJson);

/** What published data carries about the code and inputs that drew it; optional because data published before versioning has none. */
export const VersionStampSchema = z.object({
  engine: z.string().min(1),
  input: z.object({ vintage: z.string().min(1), revision: z.number().int().positive(), sha256: z.string().regex(/^[0-9a-f]{64}$/) }),
  maps: z.number().int().positive(),
  schema: z.string().min(1),
});
export type VersionStamp = z.infer<typeof VersionStampSchema>;

export type ViewerConfig = z.infer<typeof ConfigSchema>;

const HostOverrides = z
  .object({ dataBase: z.string().min(1).optional() })
  .partial()
  .optional();

function readHostOverrides(): z.infer<typeof HostOverrides> {
  const raw = (globalThis as { STR_VIEWER_CONFIG?: unknown }).STR_VIEWER_CONFIG;
  const parsed = HostOverrides.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

function resolveDataBase(override: string | undefined): string {
  const base = override ?? `${import.meta.env.BASE_URL ?? './'}data/`;
  const withSlash = base.endsWith('/') ? base : `${base}/`;
  // Resolve against the document so relative bases work when embedded.
  const origin = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';
  return new URL(withSlash, origin).toString();
}

function load(): ViewerConfig {
  const host = readHostOverrides();
  return ConfigSchema.parse({
    dataBase: resolveDataBase(host?.dataBase),
    geocoderUrl: 'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress',
    geocoderBenchmark: 'Public_AR_Current',
    geocoderVintage: 'Census2020_Current',
    geocoderLayers: 'Census Blocks',
    geocoderTimeoutMs: 15000,
    cutPlayIntervalMs: 1400,
    cutDrawMs: 650,
    movePlayIntervalMs: 1000,
    movePlayTotalMs: 45000,
    movePlayMinMs: 120,
    repoUrl: 'https://github.com/mels0n/str-redistricting',
    siteHost: 'fairmaps.melson.us',
  });
}

export const config: ViewerConfig = load();

/**
 * The shell commands that fetch the code and regenerate one state's map. With a maps release number the clone is
 * pinned to that release's tag; null (data published before versioning) clones the default branch.
 */
export function reproduceCommands(abbr: string, mapsRelease: number | null): string {
  const dir = new URL(config.repoUrl).pathname.split('/').filter(Boolean).pop() ?? '';
  const clone = mapsRelease === null ? `git clone ${config.repoUrl}` : `git clone --branch maps-${mapsRelease} --depth 1 ${config.repoUrl}`;
  return `${clone}\ncd ${dir}\nnpm install\nnpm run explore -- --states ${abbr}`;
}

export function dataUrl(path: string): string {
  return new URL(path, config.dataBase).toString();
}
