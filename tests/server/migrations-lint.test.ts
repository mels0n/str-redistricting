import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = 'supabase/migrations';
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const all = files.map((f) => ({ name: f, text: readFileSync(`${DIR}/${f}`, 'utf8') }));
const everything = all.map((f) => f.text).join('\n');

const tables = [...everything.matchAll(/create table (?:if not exists )?(\w+)/gi)].map((m) => m[1]!);
const views = [...everything.matchAll(/create (?:or replace )?view (\w+)/gi)].map((m) => m[1]!);

/** Every statement that revokes access, as the list of objects it names (`revoke all on table a, b from ...`). */
function revokedFromApiRoles(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/revoke all on (?:table|sequence) ([\w, ]+?) from ([\w, ]+);/gi)) {
    const roles = m[2]!.split(',').map((r) => r.trim());
    if (roles.includes('anon') && roles.includes('authenticated')) for (const t of m[1]!.split(',')) out.add(t.trim());
  }
  return out;
}

describe('every migration file', () => {
  it('has tables to check, and numbers its files in order', () => {
    expect(tables.length).toBeGreaterThanOrEqual(6);
    expect(files.map((f) => f.slice(0, 4))).toEqual(files.map((_, i) => String(i + 1).padStart(4, '0')));
  });

  it('enables row level security on every table it creates', () => {
    for (const t of tables) expect(everything, `RLS on ${t}`).toMatch(new RegExp(`alter table ${t} enable row level security`, 'i'));
  });

  it('creates no policies, so only the service role can use the tables', () => {
    expect(everything).not.toMatch(/create policy/i);
  });

  it('revokes every table and view from the API roles', () => {
    const revoked = new Set(all.flatMap((f) => [...revokedFromApiRoles(f.text)]));
    for (const name of [...tables, ...views]) expect(revoked.has(name), `revoke on ${name}`).toBe(true);
  });

  it('grants the service role what it uses, explicitly', () => {
    for (const name of [...tables, ...views]) expect(everything, `grant on ${name}`).toMatch(new RegExp(`grant all on table [\\w, ]*\\b${name}\\b[\\w, ]* to service_role`, 'i'));
  });

  it('keeps every view on confirmed signers or on asks, and every view invoker-secured', () => {
    for (const v of views) {
      const body = everything.slice(everything.indexOf(`view ${v}`), everything.indexOf(';', everything.indexOf(`view ${v}`)));
      expect(body, `${v} security invoker`).toContain('security_invoker = true');
      if (v === 'district_counts') expect(body).toContain("status = 'confirmed'");
    }
  });

  it('revokes every function from public and the API roles', () => {
    const revoked = [...everything.matchAll(/revoke all on function ([^;]+?) from public, anon, authenticated;/gi)].map((m) => m[1]!).join(' ');
    const created = new Set([...everything.matchAll(/create or replace function (\w+)\(/gi)].map((m) => m[1]!));
    expect(created.size).toBeGreaterThanOrEqual(6);
    for (const fn of created) expect(revoked, `revoke on ${fn}`).toMatch(new RegExp(`\\b${fn}\\(`));
  });
});
