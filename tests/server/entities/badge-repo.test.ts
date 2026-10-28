import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { badgeRepo } from '../../../src/server/entities/badge-db/index.js';

const calls: { op: string; args: unknown[] }[] = [];
const chain = (data: unknown = []): unknown =>
  new Proxy(() => undefined, {
    get: (_t, prop) => (prop === 'then' ? (ok: (v: unknown) => unknown) => ok({ data, error: null, count: 3 }) : (...args: unknown[]) => {
      calls.push({ op: String(prop), args });
      return chain(data);
    }),
  });
const client = (data?: unknown): SupabaseClient => ({ from: () => chain(data) }) as unknown as SupabaseClient;

describe('badgeRepo', () => {
  it('touch is one upsert on the address that writes only the address, host and last_seen', async () => {
    calls.length = 0;
    await badgeRepo(client()).touch('https://example.com/', 'example.com', '2026-10-27T00:00:00.000Z');
    expect(calls.map((c) => c.op)).toEqual(['upsert']);
    expect(calls[0]!.args).toEqual([{ url: 'https://example.com/', host: 'example.com', last_seen: '2026-10-27T00:00:00.000Z' }, { onConflict: 'url' }]);
  });
  it('a failed check changes only the check columns; a passed one also sets verified_at and the title', async () => {
    calls.length = 0;
    await badgeRepo(client()).recordCheck('u', { checkedAt: 'T', consecutiveFailures: 1, verified: null });
    expect(calls[0]).toEqual({ op: 'update', args: [{ last_checked: 'T', consecutive_failures: 1 }] });
    calls.length = 0;
    await badgeRepo(client()).recordCheck('u', { checkedAt: 'T', consecutiveFailures: 0, verified: { title: 'Home', foundUrl: 'https://example.com/' } });
    expect(calls[0]!.args[0]).toEqual({ last_checked: 'T', consecutive_failures: 0, verified_at: 'T', title: 'Home', found_url: 'https://example.com/' });
  });
  it('lists only verified rows that have failed fewer than twice, and maps columns', async () => {
    calls.length = 0;
    const row = { url: 'https://example.com/', host: 'example.com', first_seen: 'a', last_seen: 'b', verified_at: 'c', last_checked: 'd', consecutive_failures: 1, title: 'T', found_url: 'https://example.com/x' };
    const out = await badgeRepo(client([row])).listed(10);
    expect(calls.find((c) => c.op === 'not')!.args).toEqual(['verified_at', 'is', null]);
    expect(calls.find((c) => c.op === 'lt')!.args).toEqual(['consecutive_failures', 2]);
    expect(out).toEqual([{ url: 'https://example.com/', host: 'example.com', firstSeen: 'a', lastSeen: 'b', verifiedAt: 'c', lastChecked: 'd', consecutiveFailures: 1, title: 'T', foundUrl: 'https://example.com/x' }]);
  });
  it('turns a database error into a plain one with no details', async () => {
    const failing = (): unknown => new Proxy(() => undefined, { get: (_t, p) => (p === 'then' ? (ok: (v: unknown) => unknown) => ok({ data: null, error: { message: 'secret detail' } }) : () => failing()) });
    const bad = { from: () => failing() } as unknown as SupabaseClient;
    await expect(badgeRepo(bad).count()).rejects.toThrow('database error');
  });
});

describe('0006_badge.sql', () => {
  const sql = readFileSync('supabase/migrations/0006_badge.sql', 'utf8');
  it('adds only the one table, with the columns the code uses and no personal data', () => {
    expect(sql.match(/create table/gi)).toHaveLength(1);
    for (const c of ['url text primary key', 'host text not null', 'first_seen', 'last_seen', 'verified_at', 'last_checked', 'consecutive_failures', 'found_url', 'title']) expect(sql).toContain(c);
    const code = sql.replace(/--.*$/gm, '');
    expect(code).not.toMatch(/\bip\b|ip_hash|email/i);
    expect(code).not.toMatch(/drop |alter table (?!badge_sightings)/i);
  });
});
