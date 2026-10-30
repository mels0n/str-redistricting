import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../../vite.config';
import { DEV_API_MARK, devApi, devReply } from '../../build/dev-api';

describe('dev API stand-in', () => {
  it('is a serve-only plugin in the Vite config, so it can never be part of a build', () => {
    const plugins = (config.plugins ?? []).flat() as { name?: string; apply?: unknown }[];
    const dev = plugins.find((p) => p.name === DEV_API_MARK)!;
    expect(dev).toBeDefined();
    expect(dev.apply).toBe('serve');
    expect(devApi().apply).toBe('serve');
  });

  it('answers counts, notes, ask, sign, remove-request and remove with plausible JSON', () => {
    const none = new URLSearchParams();
    expect(devReply('GET', '/api/counts', none, {})!.body).toEqual({ national: 1234, waiting: 12 });
    const co = devReply('GET', '/api/counts', new URLSearchParams('state=CO'), {})!.body as { state: number; byKey: Record<string, number> };
    expect(co.state).toBe(87);
    expect(Object.keys(co.byKey).length).toBeGreaterThan(2);
    expect((devReply('GET', '/api/notes', new URLSearchParams('national=1'), {})!.body as { notes: unknown[] }).notes).toHaveLength(2);
    expect(devReply('POST', '/api/ask', none, { key: 'CO:us-house:01', office: 'us-house' })!.status).toBe(202);
    expect(devReply('POST', '/api/sign', none, { email: 'a@b.co', note: null })).toEqual({ status: 202, body: { status: 'check-email', queued: false, noteDropped: null } });
    expect((devReply('POST', '/api/sign', none, { email: 'queue@b.co', note: null })!.body as { queued: boolean }).queued).toBe(true);
    expect((devReply('POST', '/api/sign', none, { email: 'a@b.co', note: 'see my link' })!.body as { noteDropped: string }).noteDropped).toBe('a link');
    expect(devReply('POST', '/api/remove-request', none, {})!.status).toBe(202);
    expect(devReply('POST', '/api/remove', none, {})!.status).toBe(200);
    expect(devReply('POST', '/api/confirm', none, {})!.status).toBe(200);
    expect(devReply('GET', '/api/unknown', none, {})).toBeNull();
  });

  it('answers with totals under the display threshold in low mode, by flag or by mode', () => {
    const low = devReply('GET', '/api/counts', new URLSearchParams('state=CO'), {}, 'low')!.body as { national: number; state: number };
    expect(low.national).toBeLessThan(1000);
    expect(low.state).toBeLessThan(1000);
    expect((devReply('GET', '/api/counts', new URLSearchParams('fakeCounts=low'), {})!.body as { national: number }).national).toBeLessThan(1000);
    expect((devReply('GET', '/api/counts', new URLSearchParams(), {})!.body as { national: number }).national).toBe(1234);
  });

  it('answers /api/badge-sites with a few made-up sites in the shape the page reads, and no em dash', async () => {
    const { BadgeSitesSchema } = await import('../../src/client/entities/badge-sites');
    const reply = devReply('GET', '/api/badge-sites', new URLSearchParams(), {})!;
    expect(reply.status).toBe(200);
    const parsed = BadgeSitesSchema.parse(reply.body);
    expect(parsed.sites.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(reply.body)).toContain(DEV_API_MARK);
    expect(JSON.stringify(reply.body)).not.toContain('\u2014');
  });

  it('has no em dash in the made-up notes', () => {
    expect(JSON.stringify(devReply('GET', '/api/notes', new URLSearchParams(), {}))).not.toContain('—');
  });
});

/** The built scripts, styles and pages; the published data files hold no code. */
function builtCode(): string[] {
  const assets = readdirSync('dist/assets').map((f) => join('dist/assets', f));
  return [...assets, 'dist/index.html', 'dist/act/index.html', 'dist/pledges/index.html'].filter((f) => /\.(js|html|css)$/.test(f));
}

describe('the build carries none of the dev stand-in', () => {
  it.skipIf(!existsSync('dist/assets'))('has no mock marker and no dev check token in dist', () => {
    const hits = builtCode().filter((f) => {
      const text = readFileSync(f, 'utf8');
      return text.includes(DEV_API_MARK) || text.includes('dev-token');
    });
    expect(hits).toEqual([]);
  });
});
