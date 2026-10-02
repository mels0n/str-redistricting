import { z } from 'zod';

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
});

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
    geocoderUrl: 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress',
    geocoderBenchmark: 'Public_AR_Current',
    geocoderTimeoutMs: 15000,
    cutPlayIntervalMs: 1400,
    cutDrawMs: 650,
    movePlayIntervalMs: 1000,
    movePlayTotalMs: 45000,
    movePlayMinMs: 120,
  });
}

export const config: ViewerConfig = load();

export function dataUrl(path: string): string {
  return new URL(path, config.dataBase).toString();
}
