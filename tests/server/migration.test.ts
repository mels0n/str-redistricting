import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrate, type Sql } from '../../build/migrate.js';

describe('0001_signon.sql', () => {
  const text = readFileSync('supabase/migrations/0001_signon.sql', 'utf8');
  it('enables RLS on all three tables and has no policies', () => {
    for (const t of ['signers', 'rate_limits', 'asks']) expect(text).toContain(`alter table ${t} enable row level security`);
    expect(text).not.toMatch(/create policy/i);
  });
});

function fake(recorded: Record<string, string> = {}, failOn?: string) {
  const log: string[] = [];
  const make = (): Sql => ({
    async unsafe(q: string) {
      log.push(q.trim().split('\n')[0]!.slice(0, 60));
      if (failOn && q.includes(failOn)) throw new Error('boom');
      if (q.startsWith('select name, sha256')) return Object.entries(recorded).map(([name, sha256]) => ({ name, sha256 }));
      return [];
    },
    async begin(fn) {
      log.push('begin');
      const r = await fn(make());
      log.push('commit');
      return r;
    },
    async end() {
      log.push('end');
    },
  });
  return { sql: make(), log };
}

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'mig-'));
  for (const [n, t] of Object.entries(files)) writeFileSync(join(dir, n), t);
  return dir;
}
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const PROD = { VERCEL_ENV: 'production' };

describe('migrate', () => {
  it('skips outside production without connecting', async () => {
    const { sql, log } = fake();
    const r = await migrate({ env: { VERCEL_ENV: 'preview' }, dir: dirWith({ '0001_a.sql': 'x' }), sql });
    expect(r).toEqual({ applied: [], skipped: 'not-production' });
    expect(log).toEqual([]);
    expect((await migrate({ env: {}, dir: dirWith({}) })).skipped).toBe('not-production');
  });
  it('applies unrecorded files in filename order and records them', async () => {
    const { sql, log } = fake();
    const r = await migrate({ env: PROD, dir: dirWith({ '0002_b.sql': 'select 2', '0001_a.sql': 'select 1' }), sql });
    expect(r.applied).toEqual(['0001_a.sql', '0002_b.sql']);
    expect(log.indexOf('select 1')).toBeLessThan(log.indexOf('select 2'));
    expect(log.filter((l) => l.startsWith('insert into schema_migrations'))).toHaveLength(2);
    expect(log.filter((l) => l === 'begin')).toHaveLength(2);
  });
  it('takes the lock first and releases it last', async () => {
    const { sql, log } = fake();
    await migrate({ env: PROD, dir: dirWith({ '0001_a.sql': 'select 1' }), sql });
    expect(log[0]).toContain('pg_advisory_lock');
    expect(log.at(-2)).toContain('pg_advisory_unlock');
    expect(log.at(-1)).toBe('end');
  });
  it('skips recorded files', async () => {
    const { sql } = fake({ '0001_a.sql': sha('select 1') });
    const r = await migrate({ env: PROD, dir: dirWith({ '0001_a.sql': 'select 1', '0002_b.sql': 'select 2' }), sql });
    expect(r.applied).toEqual(['0002_b.sql']);
  });
  it('throws when a recorded file was edited, and still unlocks', async () => {
    const { sql, log } = fake({ '0001_a.sql': sha('select 1') });
    await expect(migrate({ env: PROD, dir: dirWith({ '0001_a.sql': 'select 99' }), sql })).rejects.toThrow('Migration 0001_a.sql was edited after it was applied');
    expect(log.some((l) => l.includes('pg_advisory_unlock'))).toBe(true);
    expect(log.at(-1)).toBe('end');
  });
  it('releases the lock when a migration fails', async () => {
    const { sql, log } = fake({}, 'bad stuff');
    await expect(migrate({ env: PROD, dir: dirWith({ '0001_a.sql': 'bad stuff' }), sql })).rejects.toThrow('boom');
    expect(log.some((l) => l.includes('pg_advisory_unlock'))).toBe(true);
  });
});
