import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The generator must give the same map on any engine. ECMAScript lets an engine approximate these
 * Math functions and the ** operator, so the generator uses src/server/shared/detmath instead.
 */
const ENGINE_MATH =
  /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log1p|log10|log2|pow|hypot|cbrt|random)\b/;
/** The exponentiation operator, which is specified like Math.pow. */
const POW_OPERATOR = /\*\*/;

const root = fileURLToPath(new URL('../../../src/server', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : /\.ts$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

/** Drop comments (keeping line numbers) so prose may name the functions; strings stay in. */
const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, '')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('generator arithmetic', () => {
  it('calls no engine-approximated Math function and no ** anywhere under src/server', () => {
    const files = sources(root);
    expect(files.length).toBeGreaterThan(10);
    const hits: string[] = [];
    for (const file of files) {
      stripComments(readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
        if (ENGINE_MATH.test(line) || POW_OPERATOR.test(line)) hits.push(`${relative(root, file).split(sep).join('/')}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
