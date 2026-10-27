import { parseArgs } from 'node:util';
import { z } from 'zod';
import { ConfigError } from '../errors/index.js';

export interface RepsConfig {
  /** `pin` downloads the sources and writes their hashes; `publish` verifies the hashes and writes the files. */
  readonly mode: 'pin' | 'publish';
  readonly cacheDir: string;
  readonly configDir: string;
  readonly publicDir: string;
}

const RawReps = z.object({
  mode: z.enum(['pin', 'publish'], { message: 'usage: reps <pin|publish>' }),
  cacheDir: z.string().min(1),
  configDir: z.string().min(1),
  publicDir: z.string().min(1),
});

/** Read once at boot from the command line: `pin` or `publish`, then optional directories. */
export function parseRepsConfig(argv: readonly string[]): RepsConfig {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      'cache-dir': { type: 'string', default: 'data/raw/reps' },
      'config-dir': { type: 'string', default: 'config' },
      'public-dir': { type: 'string', default: 'public/data' },
    },
    allowPositionals: true,
    strict: true,
  });
  const parsed = RawReps.safeParse({ mode: positionals[0], cacheDir: values['cache-dir'], configDir: values['config-dir'], publicDir: values['public-dir'] });
  if (!parsed.success || positionals.length !== 1) throw new ConfigError(parsed.success ? 'usage: reps <pin|publish>' : parsed.error.issues.map((i) => i.message).join('; '));
  return parsed.data;
}
