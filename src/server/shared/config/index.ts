import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { stateByAbbr, type StateInfo } from '../apportionment/index.js';
import { ConfigError } from '../errors/index.js';

export { CENSUS_SHA256, ManifestSchema, pinnedSha256 } from './census-manifest.js';
export { ENACTED_CONFIG, EnactedConfigSchema, enactedFileName, parseEnactedFileName } from './enacted.js';
export type { EnactedConfig } from './enacted.js';

export interface Config {
  readonly states: StateInfo[];
  readonly angleStepDeg: number;
  readonly cacheDir: string;
  readonly outDir: string;
  /** Threads for the cut search; 1 searches on the main thread only. */
  readonly threads: number;
}

const STATES_REQUIRED = '--states is required (two-letter abbreviations, comma separated, for example CO or RI,CT)';

const Raw = z.object({
  states: z.string(STATES_REQUIRED).min(1, STATES_REQUIRED),
  angleStep: z.coerce.number().positive().max(10)
    .refine((v) => Math.abs(180 / v - Math.round(180 / v)) < 1e-9, 'angle step must divide 180 exactly'),
  cacheDir: z.string().min(1),
  outDir: z.string().min(1),
  threads: z.string().regex(/^\d+$/, 'threads must be a whole number').transform(Number).pipe(z.number().int().min(1, 'threads must be at least 1')),
});

/** Read once at boot from the command line. */
export function parseConfig(argv: readonly string[]): Config {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      states: { type: 'string' },
      'angle-step': { type: 'string', default: '0.1' },
      'cache-dir': { type: 'string', default: 'data/raw' },
      'out-dir': { type: 'string', default: 'out' },
      threads: { type: 'string', default: String(Math.max(1, availableParallelism() - 2)) },
    },
    strict: true,
  });
  const parsed = Raw.safeParse({
    states: values.states,
    angleStep: values['angle-step'],
    cacheDir: values['cache-dir'],
    outDir: values['out-dir'],
    threads: values.threads,
  });
  if (!parsed.success) throw new ConfigError(parsed.error.issues.map((i) => i.message).join('; '));
  const states = parsed.data.states.split(',').map((s) => s.trim()).filter(Boolean).map((abbr) => {
    const info = stateByAbbr(abbr);
    if (!info) throw new ConfigError(`unknown state: ${abbr}`);
    return info;
  });
  return { states, angleStepDeg: parsed.data.angleStep, cacheDir: parsed.data.cacheDir, outDir: parsed.data.outDir, threads: parsed.data.threads };
}

export interface PublishConfig {
  /** Limit the heavy work to these states; undefined means every state with a generated plan. */
  readonly states: StateInfo[] | undefined;
  readonly cacheDir: string;
  readonly outDir: string;
  readonly publicDir: string;
  /** Rebuild only what depends on the enacted-districts file, from the already published files; needs no generated plans. */
  readonly enactedOnly: boolean;
}

const RawPublish = z.object({
  states: z.string().min(1).optional(),
  cacheDir: z.string().min(1),
  outDir: z.string().min(1),
  publicDir: z.string().min(1),
  enactedOnly: z.boolean(),
});

/** Read once at boot from the command line. */
export function parsePublishConfig(argv: readonly string[]): PublishConfig {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      states: { type: 'string' },
      'cache-dir': { type: 'string', default: 'data/raw' },
      'out-dir': { type: 'string', default: 'out' },
      'public-dir': { type: 'string', default: 'public/data' },
      'enacted-only': { type: 'boolean', default: false },
    },
    strict: true,
  });
  const parsed = RawPublish.safeParse({
    states: values.states, cacheDir: values['cache-dir'], outDir: values['out-dir'], publicDir: values['public-dir'], enactedOnly: values['enacted-only'],
  });
  if (!parsed.success) throw new ConfigError(parsed.error.issues.map((i) => i.message).join('; '));
  const states = parsed.data.states?.split(',').map((s) => s.trim()).filter(Boolean).map((abbr) => {
    const info = stateByAbbr(abbr);
    if (!info) throw new ConfigError(`unknown state: ${abbr}`);
    return info;
  });
  return { states, cacheDir: parsed.data.cacheDir, outDir: parsed.data.outDir, publicDir: parsed.data.publicDir, enactedOnly: parsed.data.enactedOnly };
}

export interface RuleExamplesConfig {
  readonly outDir: string;
  readonly repeatDir: string;
  readonly rawDir: string;
  readonly dest: string;
  /** Threads for re-running a cut's search to trace it; 1 searches on the main thread only. */
  readonly threads: number;
}

const RawRuleExamples = z.object({
  outDir: z.string().min(1),
  repeatDir: z.string().min(1),
  rawDir: z.string().min(1),
  dest: z.string().min(1),
  threads: Raw.shape.threads,
});

/** Read once at boot from the command line. */
export function parseRuleExamplesConfig(argv: readonly string[]): RuleExamplesConfig {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      'out-dir': { type: 'string', default: 'out' },
      'repeat-dir': { type: 'string', default: 'out-repeat' },
      'raw-dir': { type: 'string', default: 'data/raw' },
      dest: { type: 'string', default: 'public/data/how/rule-examples.json' },
      threads: { type: 'string', default: String(Math.max(1, availableParallelism() - 2)) },
    },
    strict: true,
  });
  const parsed = RawRuleExamples.safeParse({
    outDir: values['out-dir'], repeatDir: values['repeat-dir'], rawDir: values['raw-dir'], dest: values.dest, threads: values.threads,
  });
  if (!parsed.success) throw new ConfigError(parsed.error.issues.map((i) => i.message).join('; '));
  return parsed.data;
}

export interface EnactedBumpConfig {
  /** The enacted-districts file to adopt, e.g. cb_2027_us_cd120_500k. */
  readonly file: string;
  readonly cacheDir: string;
  readonly publicDir: string;
  readonly configDir: string;
  /** Update the config and manifest only; leave the published data for a separate `publish-data --enacted-only`. */
  readonly skipPublish: boolean;
}

const RawBump = z.object({
  file: z.string().regex(/^cb_\d{4}_us_cd\d+_500k$/, 'file must look like cb_2027_us_cd120_500k (no .zip)'),
  cacheDir: z.string().min(1),
  publicDir: z.string().min(1),
  configDir: z.string().min(1),
  skipPublish: z.boolean(),
});

/** Read once at boot from the command line. */
export function parseEnactedBumpConfig(argv: readonly string[]): EnactedBumpConfig {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      file: { type: 'string' },
      'cache-dir': { type: 'string', default: 'data/raw' },
      'public-dir': { type: 'string', default: 'public/data' },
      'config-dir': { type: 'string', default: 'config' },
      'skip-publish': { type: 'boolean', default: false },
    },
    strict: true,
  });
  const parsed = RawBump.safeParse({
    file: values.file, cacheDir: values['cache-dir'], publicDir: values['public-dir'], configDir: values['config-dir'], skipPublish: values['skip-publish'],
  });
  if (!parsed.success) throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; '));
  return parsed.data;
}
