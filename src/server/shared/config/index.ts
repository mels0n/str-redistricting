import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { stateByAbbr, type StateInfo } from '../apportionment/index.js';
import { ConfigError } from '../errors/index.js';

export interface Config {
  readonly states: StateInfo[];
  readonly angleStepDeg: number;
  readonly cacheDir: string;
  readonly outDir: string;
  /** Threads for the cut search; 1 searches on the main thread only. */
  readonly threads: number;
}

const Raw = z.object({
  states: z.string().min(1),
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
}

const RawPublish = z.object({
  states: z.string().min(1).optional(),
  cacheDir: z.string().min(1),
  outDir: z.string().min(1),
  publicDir: z.string().min(1),
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
    },
    strict: true,
  });
  const parsed = RawPublish.safeParse({ states: values.states, cacheDir: values['cache-dir'], outDir: values['out-dir'], publicDir: values['public-dir'] });
  if (!parsed.success) throw new ConfigError(parsed.error.issues.map((i) => i.message).join('; '));
  const states = parsed.data.states?.split(',').map((s) => s.trim()).filter(Boolean).map((abbr) => {
    const info = stateByAbbr(abbr);
    if (!info) throw new ConfigError(`unknown state: ${abbr}`);
    return info;
  });
  return { states, cacheDir: parsed.data.cacheDir, outDir: parsed.data.outDir, publicDir: parsed.data.publicDir };
}
