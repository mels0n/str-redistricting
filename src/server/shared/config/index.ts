import { parseArgs } from 'node:util';
import { z } from 'zod';
import { stateByAbbr, type StateInfo } from '../apportionment/index.js';
import { ConfigError } from '../errors/index.js';

export interface Config {
  readonly states: StateInfo[];
  readonly angleStepDeg: number;
  readonly cacheDir: string;
  readonly outDir: string;
}

const Raw = z.object({
  states: z.string().min(1),
  angleStep: z.coerce.number().positive().max(10)
    .refine((v) => Math.abs(180 / v - Math.round(180 / v)) < 1e-9, 'angle step must divide 180 exactly'),
  cacheDir: z.string().min(1),
  outDir: z.string().min(1),
});

/** Read once at boot from the command line. */
export function parseConfig(argv: readonly string[]): Config {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      states: { type: 'string' },
      'angle-step': { type: 'string', default: '0.5' },
      'cache-dir': { type: 'string', default: 'data/raw' },
      'out-dir': { type: 'string', default: 'out' },
    },
    strict: true,
  });
  const parsed = Raw.safeParse({
    states: values.states,
    angleStep: values['angle-step'],
    cacheDir: values['cache-dir'],
    outDir: values['out-dir'],
  });
  if (!parsed.success) throw new ConfigError(parsed.error.issues.map((i) => i.message).join('; '));
  const states = parsed.data.states.split(',').map((s) => s.trim()).filter(Boolean).map((abbr) => {
    const info = stateByAbbr(abbr);
    if (!info) throw new ConfigError(`unknown state: ${abbr}`);
    return info;
  });
  return { states, angleStepDeg: parsed.data.angleStep, cacheDir: parsed.data.cacheDir, outDir: parsed.data.outDir };
}
