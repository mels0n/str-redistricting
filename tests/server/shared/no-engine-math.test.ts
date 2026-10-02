import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The generator must give the same map on any engine. ECMAScript lets an engine approximate most Math
 * functions and the ** operator, so the generator uses src/server/shared/detmath instead. Only the Math
 * members that are exact on every engine are allowed: constants, rounding to whole numbers, comparisons,
 * sign and absolute value, the correctly rounded square root, and exact integer operations. Anything
 * else under Math, including a member added to the language later, is refused.
 */
const ALLOWED_MATH = new Set(['floor', 'ceil', 'round', 'trunc', 'abs', 'min', 'max', 'sqrt', 'sign', 'imul', 'clz32', 'fround', 'PI']);
/** Every use of the Math object; a use that is not `Math.<allowed member>` is a hit. */
const MATH_USE = /\bMath\b(\s*\.\s*([A-Za-z_$][\w$]*))?/g;
/** The exponentiation operator, which is specified like Math.pow. */
const POW_OPERATOR = /\*\*/;

/** The Math uses on a line that are not allowed, as written. */
function badMath(line: string): string[] {
  return [...line.matchAll(MATH_USE)].filter((m) => m[2] === undefined || !ALLOWED_MATH.has(m[2])).map((m) => m[0]);
}

const root = fileURLToPath(new URL('../../../src/server', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : /\.ts$/.test(e.name) ? [join(dir, e.name)] : [],
  );
}

/** Drop comments (keeping line numbers) so prose may name the functions; strings stay in. */
const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, '')).replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('generator arithmetic', () => {
  it('recognizes a Math member that is not allowed', () => {
    expect(badMath('x = Math.sin(a) + Math.floor(b)')).toEqual(['Math.sin']);
    expect(badMath('const { cos } = Math;')).toEqual(['Math']);
    expect(badMath('Math [ "tan" ](a)')).toEqual(['Math']);
    expect(badMath('Math.max(Math.abs(a), Math.PI)')).toEqual([]);
  });

  it('uses only allowed Math members and no ** anywhere under src/server', () => {
    const files = sources(root);
    expect(files.length).toBeGreaterThan(10);
    const hits: string[] = [];
    for (const file of files) {
      stripComments(readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
        if (badMath(line).length > 0 || POW_OPERATOR.test(line)) hits.push(`${relative(root, file).split(sep).join('/')}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
