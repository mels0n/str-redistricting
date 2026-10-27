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
  let locked = false;
  try {
    await sql.unsafe('select pg_advisory_lock($1)', [LOCK_ID]);
    locked = true;
    await sql.unsafe('create table if not exists schema_migrations (name text primary key, sha256 text not null, applied_at timestamptz not null default now())');
    // The table sits in the public schema, which the API roles can reach: lock it every run, since grants only apply to a table when it is created.
    await sql.unsafe('alter table schema_migrations enable row level security');
    await sql.unsafe('revoke all on table schema_migrations from public, anon, authenticated');
    const rows = await sql.unsafe('select name, sha256 from schema_migrations');
    const recorded = new Map(rows.map((r) => [String(r.name), String(r.sha256)]));
    // Check every recorded migration against disk before applying anything new.
    for (const [name, prior] of recorded) {
      if (!files.includes(name)) throw new Error(`Migration ${name} was applied but its file is missing`);
      if (prior !== sha256(readFileSync(join(opts.dir, name), 'utf8'))) throw new Error(`Migration ${name} was edited after it was applied`);
    }
    for (const name of files) {
      if (recorded.has(name)) continue;
      const text = readFileSync(join(opts.dir, name), 'utf8');
      const digest = sha256(text);
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx.unsafe('insert into schema_migrations (name, sha256) values ($1, $2)', [name, digest]);
      });
      applied.push(name);
    }
  } finally {
    // A failing unlock or close must not replace the error that got us here.
    if (locked) await sql.unsafe('select pg_advisory_unlock($1)', [LOCK_ID]).then(undefined, () => undefined);
    await sql.end().catch(() => undefined);
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
