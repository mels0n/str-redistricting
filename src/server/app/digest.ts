import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { notesRepo } from '../entities/signon-db/index.js';
import { buildDigest } from '../features/notes/index.js';
import { loadEncryptionKey } from '../shared/config/backend.js';
import { ConfigError, exitCodeFor } from '../shared/errors/index.js';

// Writes the Markdown for one district: how many people signed, and every note that is public on the site (approved, from a
// confirmed signer who ticked the show-name-and-town box). The database and encryption keys come from the local .env (or the environment); nothing is printed from them.

const Args = z.object({
  key: z.string().regex(/^[A-Z]{2}:(us-house|us-senate|state-house|state-senate):[A-Za-z0-9-]{1,12}$/, 'must look like CO:us-house:03'),
  out: z.string().min(1).optional(),
});

/** Read once at boot from the command line: `--key CO:us-house:03 [--out file.md]`. */
function parseDigestArgs(argv: readonly string[]): z.infer<typeof Args> {
  const { values } = parseArgs({ args: [...argv], options: { key: { type: 'string' }, out: { type: 'string' } }, strict: true });
  const parsed = Args.safeParse({ key: values.key, out: values.out });
  if (!parsed.success) throw new ConfigError(`usage: digest --key CO:us-house:03 [--out file.md] (${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')})`);
  return parsed.data;
}

async function digest(): Promise<void> {
  const { key, out } = parseDigestArgs(process.argv.slice(2));
  try {
    process.loadEnvFile('.env');
  } catch {
    // No .env file: the variables may already be in the environment.
  }
  const text = await buildDigest(key, notesRepo(), loadEncryptionKey());
  if (out) writeFileSync(out, text);
  else process.stdout.write(text);
}

try {
  await digest();
} catch (err) {
  // Only the error type or a message about configuration; a database error carries no query or row.
  console.error(err instanceof Error && err.name === 'ConfigError' ? err.message : 'digest failed');
  process.exit(exitCodeFor(err));
}
