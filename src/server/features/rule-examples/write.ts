import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DataError } from '../../shared/errors/index.js';
import { RuleExamplesSchema, type RuleCase } from './schema.js';

/** The published file ships with the How page, so it has a hard budget. */
export const MAX_BYTES = 204_800;

const sortKeys = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, sortKeys(x)]));
  }
  return v;
};

/** Validate, order cases by id, serialize with sorted keys (byte-stable) and write; returns the byte size. */
export async function writeRuleExamples(dest: string, cases: readonly RuleCase[]): Promise<number> {
  const ids = cases.map((c) => c.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new DataError(`duplicate case id: ${dup}`);
  const parsed = RuleExamplesSchema.safeParse({ version: 1, cases: [...cases].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) });
  if (!parsed.success) throw new DataError(`rule examples invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  const text = `${JSON.stringify(sortKeys(parsed.data))}\n`;
  const bytes = Buffer.byteLength(text);
  if (bytes > MAX_BYTES) throw new DataError(`rule examples are ${bytes} bytes, over the ${MAX_BYTES} byte budget`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, text);
  return bytes;
}
