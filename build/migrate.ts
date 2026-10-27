import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The slice of a postgres.js client the runner uses. Tests pass a fake. */
export interface Sql {
  unsafe(query: string, params?: unknown[]): PromiseLike<Record<string, unknown>[]>;
  begin<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

const LOCK_ID = 727274;
// The Postgres URL name lives only here (Supabase's non-pooling connection string).
const URL_ENV = 'BACKERS_POSTGRES_URL_NON_POOLING';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** Applies supabase/migrations/*.sql not yet recorded, only in the Vercel production build. Migrations are append-only. */
export async function migrate(opts: { env: NodeJS.ProcessEnv; dir: string; sql?: Sql }): Promise<{ applied: string[]; skipped: 'not-production' | null }> {
  if (opts.env.VERCEL_ENV !== 'production') return { applied: [], skipped: 'not-production' };
  const files = readdirSync(opts.dir).filter((f) => f.endsWith('.sql')).sort();
  const sql = opts.sql ?? (await connect(opts.env));
  const applied: string[] = [];
  try {
    await sql.unsafe('select pg_advisory_lock($1)', [LOCK_ID]);
    try {
      await sql.unsafe('create table if not exists schema_migrations (name text primary key, sha256 text not null, applied_at timestamptz not null default now())');
      const rows = await sql.unsafe('select name, sha256 from schema_migrations');
      const recorded = new Map(rows.map((r) => [String(r.name), String(r.sha256)]));
      for (const name of files) {
        const text = readFileSync(join(opts.dir, name), 'utf8');
        const digest = sha256(text);
        const prior = recorded.get(name);
        if (prior !== undefined) {
          if (prior !== digest) throw new Error(`Migration ${name} was edited after it was applied`);
          continue;
        }
        await sql.begin(async (tx) => {
          await tx.unsafe(text);
          await tx.unsafe('insert into schema_migrations (name, sha256) values ($1, $2)', [name, digest]);
        });
        applied.push(name);
      }
    } finally {
      await sql.unsafe('select pg_advisory_unlock($1)', [LOCK_ID]);
    }
  } finally {
    await sql.end();
  }
  return { applied, skipped: null };
}

async function connect(env: NodeJS.ProcessEnv): Promise<Sql> {
  const url = env[URL_ENV];
  if (!url) throw new Error(`${URL_ENV} is not set`);
  const { default: postgres } = await import('postgres');
  // One connection, so the session-level advisory lock and the migrations share it.
  return postgres(url, { ssl: 'require', max: 1, onnotice: () => {} }) as unknown as Sql;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await migrate({ env: process.env, dir: 'supabase/migrations' });
    console.log(result.skipped ? `migrations skipped (${result.skipped})` : `migrations applied: ${result.applied.join(', ') || 'none'}`);
  } catch (err) {
    // The message names a migration or a missing variable, never a connection string.
    console.error(`migrate failed: ${err instanceof Error ? err.message.split('\n')[0] : 'unknown error'}`);
    process.exit(1);
  }
}
