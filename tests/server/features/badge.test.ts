import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BadgeRepo, CheckResult, Sighting } from '../../../src/server/entities/badge-db/index.js';
import { UNLIST_AFTER_FAILURES } from '../../../src/server/entities/badge-db/index.js';
import { badgeHandler } from '../../../src/server/api/badge.js';
import { badgeSitesHandler } from '../../../src/server/api/badge-sites.js';
import { BADGE_SVG, CHECK_CONCURRENCY, IMMEDIATE_CHECKS_PER_HOUR, MAX_PER_HOST, MAX_SIGHTINGS, RUN_BUDGET_MS, SITE_CHECK_MS, checkerUserAgent, SITES_PER_RUN, cleanTitle, clearWebsitesCache, loadWebsites, normalizeReferrer, readBadgeSites, recordSighting, robotsAllows, runBadgeChecks, scanForBadge, verifyNow, type FetchPage } from '../../../src/server/features/badge/index.js';
import { SsrfError } from '../../../src/server/shared/ssrf/index.js';

const HOST = 'fairmaps.melson.us';
const OWN = [HOST, 'localhost'];

class MemoryRepo implements BadgeRepo {
  rows = new Map<string, Sighting>();
  async find(url: string): Promise<Sighting | null> {
    return this.rows.get(url) ?? null;
  }
  async count(): Promise<number> {
    return this.rows.size;
  }
  async countHost(host: string): Promise<number> {
    return [...this.rows.values()].filter((r) => r.host === host).length;
  }
  async touch(url: string, host: string, nowIso: string): Promise<void> {
    const old = this.rows.get(url);
    this.rows.set(url, old ? { ...old, lastSeen: nowIso } : { url, host, firstSeen: nowIso, lastSeen: nowIso, verifiedAt: null, lastChecked: null, consecutiveFailures: 0, title: null, foundUrl: null });
  }
  async dueForCheck(beforeIso: string, limit: number): Promise<Sighting[]> {
    return [...this.rows.values()]
      .filter((r) => r.lastChecked === null || r.lastChecked < beforeIso)
      .sort((a, b) => (a.lastChecked ?? '').localeCompare(b.lastChecked ?? ''))
      .slice(0, limit);
  }
  async recordCheck(url: string, r: CheckResult): Promise<void> {
    const old = this.rows.get(url)!;
    this.rows.set(url, { ...old, lastChecked: r.checkedAt, consecutiveFailures: r.consecutiveFailures, ...(r.verified ? { verifiedAt: r.checkedAt, title: r.verified.title, foundUrl: r.verified.foundUrl } : {}) });
  }
  async listed(limit: number): Promise<Sighting[]> {
    return [...this.rows.values()]
      .filter((r) => r.verifiedAt !== null && r.consecutiveFailures < UNLIST_AFTER_FAILURES)
      .sort((a, b) => b.firstSeen.localeCompare(a.firstSeen))
      .slice(0, limit);
  }
  async prune(beforeIso: string): Promise<void> {
    for (const [k, r] of this.rows) {
      if ((r.lastSeen < beforeIso && (r.verifiedAt === null || r.verifiedAt < beforeIso)) || (r.verifiedAt === null && r.consecutiveFailures >= UNLIST_AFTER_FAILURES)) this.rows.delete(k);
    }
  }
}

const NOW = new Date('2026-10-27T12:00:00.000Z');

describe('the served image', () => {
  it('is the same file as public/badge.svg', () => {
    expect(BADGE_SVG).toBe(readFileSync('public/badge.svg', 'utf8'));
  });
});

describe('normalizeReferrer', () => {
  it('keeps the origin and path, drops the query and fragment, lower-cases the host, and stores https', () => {
    expect(normalizeReferrer('https://Example.COM/a/b?utm=1#frag', OWN)).toEqual({ url: 'https://example.com/a/b', host: 'example.com' });
    expect(normalizeReferrer('http://example.org/page?x=1', OWN)).toEqual({ url: 'https://example.org/page', host: 'example.org' });
    expect(normalizeReferrer('https://example.org', OWN)).toEqual({ url: 'https://example.org/', host: 'example.org' });
  });
  it('ignores our own site and localhost, with or without www', () => {
    for (const u of [`https://${HOST}/pledges`, `https://${HOST}/`, `https://www.${HOST}/x`, 'http://localhost:5173/', 'https://localhost/']) expect(normalizeReferrer(u, OWN), u).toBeNull();
  });
  it('ignores anything that is not an http or https page on a public name', () => {
    for (const u of ['', 'null', 'android-app://com.example.app/', 'file:///x', 'ftp://example.com/', 'javascript:1', 'https://user:pw@example.com/', 'https://user@example.com/', 'https://example.com:8443/', 'http://example.com:80x/', 'https://127.0.0.1/', 'https://[::1]/', 'https://10.0.0.1/', 'https://intranet/', 'https://printer.local/', 'https://x.internal/']) expect(normalizeReferrer(u, OWN), u).toBeNull();
    expect(normalizeReferrer(null, OWN)).toBeNull();
    expect(normalizeReferrer(undefined, OWN)).toBeNull();
  });
  it('ignores an address over 300 characters instead of cutting it', () => {
    const long = `https://example.com/${'a'.repeat(300)}`;
    expect(normalizeReferrer(long, OWN)).toBeNull();
    const fits = `https://example.com/${'a'.repeat(300 - 'https://example.com/'.length)}`;
    expect(normalizeReferrer(fits, OWN)?.url).toBe(fits);
    expect(normalizeReferrer(`https://example.com/?${'q'.repeat(5000)}`, OWN)).toBeNull();
  });
});

describe('recordSighting', () => {
  let repo: MemoryRepo;
  let limited: number;
  const deps = (over: Partial<Parameters<typeof recordSighting>[1]> = {}): Parameters<typeof recordSighting>[1] => ({
    repo,
    ownHosts: OWN,
    limit: async () => {
      limited++;
    },
    now: NOW,
    ...over,
  });
  beforeEach(() => {
    repo = new MemoryRepo();
    limited = 0;
  });

  it('records a page once, with the query dropped', async () => {
    expect((await recordSighting('https://example.com/news?a=1', deps())).outcome).toBe('recorded');
    expect([...repo.rows.keys()]).toEqual(['https://example.com/news']);
    expect(repo.rows.get('https://example.com/news')!.host).toBe('example.com');
  });
  it('asks for an immediate check of a new page and of one never checked, but leaves failing and never-verified pages to the daily run', async () => {
    const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000);
    const url = 'https://example.com/';
    expect(await recordSighting(url, deps())).toMatchObject({ outcome: 'recorded', url, needsCheck: true });
    // seen again after the first check was lost (never checked): check now
    expect((await recordSighting(url, deps({ now: at(1.5) }))).needsCheck).toBe(true);
    // checked and failed, never verified: not again until the daily run, however often it is seen
    await repo.recordCheck(url, { checkedAt: at(1.6).toISOString(), consecutiveFailures: 1, verified: null });
    expect((await recordSighting(url, deps({ now: at(3) }))).needsCheck).toBe(false);
    expect((await recordSighting(url, deps({ now: at(40) }))).needsCheck).toBe(false);
    // verified, then failing: also left alone
    await repo.recordCheck(url, { checkedAt: at(41).toISOString(), consecutiveFailures: 0, verified: { title: null, foundUrl: url } });
    await repo.recordCheck(url, { checkedAt: at(42).toISOString(), consecutiveFailures: 1, verified: null });
    expect((await recordSighting(url, deps({ now: at(80) }))).needsCheck).toBe(false);
    // verified and passing: no check until a day has passed
    await repo.recordCheck(url, { checkedAt: at(81).toISOString(), consecutiveFailures: 0, verified: { title: null, foundUrl: url } });
    expect((await recordSighting(url, deps({ now: at(83) }))).needsCheck).toBe(false);
    expect((await recordSighting(url, deps({ now: at(106) }))).needsCheck).toBe(true);
    // a page that was not written (fresh, ignored, limited) never asks for a check
    expect(await recordSighting(url, deps({ now: at(106.1) }))).toMatchObject({ outcome: 'fresh', url: null, needsCheck: false });
    expect(await recordSighting(`https://${HOST}/`, deps())).toMatchObject({ outcome: 'ignored', needsCheck: false });
  });
  it('refuses a fourth new page of one host, but still refreshes the three it has and takes other hosts', async () => {
    for (const p of ['a', 'b', 'c']) expect((await recordSighting(`https://example.com/${p}`, deps())).outcome).toBe('recorded');
    expect((await recordSighting('https://example.com/d', deps())).outcome).toBe('crowded');
    expect(repo.rows.has('https://example.com/d')).toBe(false);
    expect((await recordSighting('https://example.com/a', deps({ now: new Date(NOW.getTime() + 2 * 3_600_000) }))).outcome).toBe('recorded');
    expect((await recordSighting('https://other.example.org/', deps())).outcome).toBe('recorded');
  });
  it('writes a page at most once an hour, and a repeat does not use the visitor allowance', async () => {
    await recordSighting('https://example.com/', deps());
    expect(limited).toBe(1);
    expect((await recordSighting('https://example.com/', deps({ now: new Date(NOW.getTime() + 30 * 60_000) }))).outcome).toBe('fresh');
    expect(limited).toBe(1);
    expect((await recordSighting('https://example.com/', deps({ now: new Date(NOW.getTime() + 61 * 60_000) }))).outcome).toBe('recorded');
    expect(repo.rows.get('https://example.com/')!.lastSeen).toBe(new Date(NOW.getTime() + 61 * 60_000).toISOString());
  });
  it('keeps what the checks found when a page is seen again', async () => {
    await recordSighting('https://example.com/', deps());
    await repo.recordCheck('https://example.com/', { checkedAt: NOW.toISOString(), consecutiveFailures: 0, verified: { title: 'Home', foundUrl: 'https://example.com/' } });
    await recordSighting('https://example.com/', deps({ now: new Date(NOW.getTime() + 2 * 3_600_000) }));
    expect(repo.rows.get('https://example.com/')).toMatchObject({ verifiedAt: NOW.toISOString(), title: 'Home' });
  });
  it('ignores our own site and bad referrers without touching the limit or the table', async () => {
    expect((await recordSighting(`https://${HOST}/pledges`, deps())).outcome).toBe('ignored');
    expect((await recordSighting('http://127.0.0.1/', deps())).outcome).toBe('ignored');
    expect((await recordSighting(null, deps())).outcome).toBe('ignored');
    expect(limited).toBe(0);
    expect(repo.rows.size).toBe(0);
  });
  it('writes nothing when the visitor is over the limit', async () => {
    expect((await recordSighting('https://example.com/', deps({ limit: async () => Promise.reject(new Error('rate-limit')) }))).outcome).toBe('limited');
    expect(repo.rows.size).toBe(0);
  });
  it('refuses a new page once the table is full, but still refreshes a known one', async () => {
    await recordSighting('https://a.example.com/', deps({ maxRows: 2 }));
    await recordSighting('https://b.example.com/', deps({ maxRows: 2 }));
    expect((await recordSighting('https://c.example.com/', deps({ maxRows: 2 }))).outcome).toBe('full');
    expect(repo.rows.size).toBe(2);
    expect((await recordSighting('https://a.example.com/', deps({ maxRows: 2, now: new Date(NOW.getTime() + 2 * 3_600_000) }))).outcome).toBe('recorded');
  });
});

describe('scanForBadge', () => {
  const page = 'https://example.com/about/';
  const scan = (html: string) => scanForBadge(html, page, HOST);
  const both = (inner = '') => `<a href="https://${HOST}/pledges"><img src="https://${HOST}/api/badge" alt="Fair Maps"></a>${inner}`;

  it('finds the image from /api/badge and a link to the pledges page', () => {
    expect(scan(`<html><body>${both()}</body></html>`)).toMatchObject({ badge: true, link: true });
  });
  describe('the recognised setups', () => {
    const ok = { badge: true, link: true };
    it('A: the badge image wrapped in a link to our site (any path)', () => {
      for (const path of ['', '/', '/pledges', '/how', '/MA/house']) expect(scan(`<a href="https://${HOST}${path}"><img src="https://${HOST}/api/badge"></a>`), path).toMatchObject(ok);
    });
    it('B: the badge image plus a link to our site elsewhere on the page, wrapped or not', () => {
      expect(scan(`<img src="https://${HOST}/api/badge"><footer><a href="https://${HOST}/pledges">Fair Maps</a></footer>`)).toMatchObject(ok);
      expect(scan(`<p><a href="https://other.example.org/"><img src="https://${HOST}/api/badge"></a></p><a href="https://${HOST}/">Fair Maps</a>`)).toMatchObject(ok);
    });
    it('accepts the http spelling, www, and the older /badge.svg address', () => {
      expect(scan(`<a href="http://${HOST}/pledges"><img src="http://${HOST}/api/badge"></a>`)).toMatchObject(ok);
      expect(scan(`<a href="https://www.${HOST}/pledges"><img src="https://www.${HOST}/badge.svg"></a>`)).toMatchObject(ok);
    });
    it('does not recognise lazy-loading attributes, srcset, picture, object or CSS backgrounds', () => {
      expect(scan(`<a href="https://${HOST}/pledges"><img data-src="https://${HOST}/api/badge" src="data:image/gif;base64,R0lG"></a>`)).toMatchObject({ badge: false });
      expect(scan(`<a href="https://${HOST}/pledges"><picture><source srcset="https://${HOST}/api/badge"></picture></a>`)).toMatchObject({ badge: false });
      expect(scan(`<a href="https://${HOST}/pledges"><object data="https://${HOST}/api/badge"></object></a>`)).toMatchObject({ badge: false });
    });
    it('is not satisfied by the badge alone, a link alone, or a link from another site', () => {
      expect(scan(`<img src="https://${HOST}/api/badge">`)).toMatchObject({ badge: true, link: false });
      expect(scan(`<a href="https://${HOST}/pledges">x</a>`)).toMatchObject({ badge: false, link: true });
      expect(scan(`<a href="https://other.example.org/"><img src="https://${HOST}/api/badge"></a>`)).toMatchObject({ link: false });
    });
  });
  it('finds the image from /badge.svg too', () => {
    expect(scan(`<a href="https://${HOST}/"><img src="https://${HOST}/badge.svg"></a>`)).toMatchObject({ badge: true, link: true });
  });
  it('reads tags and attributes in any case, with single quotes, no quotes or extra spacing', () => {
    expect(scan(`<A HREF='https://${HOST}/pledges'><IMG SRC=https://${HOST}/api/badge ALT=x /></A>`)).toMatchObject({ badge: true, link: true });
    expect(scan(`<a\n  href = "https://${HOST.toUpperCase()}/pledges" ><img\nsrc = "https://${HOST}/api/badge"></a>`)).toMatchObject({ badge: true, link: true });
  });
  it('accepts www, protocol-relative and entity-encoded addresses', () => {
    expect(scan(`<a href="//www.${HOST}/pledges"><img src="https://www.${HOST}/api/badge"></a>`)).toMatchObject({ badge: true, link: true });
    expect(scan(`<a href="https://${HOST}/pledges?a=1&amp;b=2"><img src="https://${HOST}/api/badge?x=1&amp;y=2"></a>`)).toMatchObject({ badge: true, link: true });
  });
  it('does not count an image that is only a path on the page itself', () => {
    expect(scan(`<a href="https://${HOST}/pledges"><img src="/api/badge"></a>`)).toMatchObject({ badge: false, link: true });
    expect(scan(`<a href="/pledges"><img src="/badge.svg"></a>`)).toMatchObject({ badge: false, link: false });
  });
  it('reports a badge with no link back as present but not linked', () => {
    expect(scan(`<img src="https://${HOST}/api/badge">`)).toMatchObject({ badge: true, link: false });
    expect(scan(`<a href="https://${HOST}/api/badge">badge</a>`)).toMatchObject({ badge: false, link: false });
    expect(scan(`<img src="https://${HOST}/api/badge"><a href="https://other.example.com/">x</a>`)).toMatchObject({ badge: true, link: false });
  });
  it('does not verify a page with two anchors and no image', async () => {
    const repo = new MemoryRepo();
    await repo.touch('https://example.com/', 'example.com', NOW.toISOString());
    const html = `<a href="https://${HOST}/pledges">Fair Maps</a><a href="https://${HOST}/api/badge">badge file</a>`;
    await runBadgeChecks({ repo, siteHost: HOST, now: () => NOW, deadline: Date.now() + 60_000, log: () => undefined, fetchPage: async (u) => (u.endsWith('/robots.txt') ? { status: 404, url: u, contentType: null, body: '' } : { status: 200, url: u, contentType: 'text/html', body: html }) });
    expect(repo.rows.get('https://example.com/')).toMatchObject({ verifiedAt: null, consecutiveFailures: 1 });
  });
  it('reports a link with no badge', () => {
    expect(scan(`<a href="https://${HOST}/pledges">Fair Maps</a>`)).toMatchObject({ badge: false, link: true });
  });
  it('ignores look-alike hosts and other paths', () => {
    expect(scan(`<a href="https://${HOST}.evil.org/pledges"><img src="https://${HOST}.evil.org/api/badge"></a>`)).toMatchObject({ badge: false, link: false });
    expect(scan(`<a href="https://evil.org/${HOST}/pledges"><img src="https://evil.org/${HOST}/api/badge"></a>`)).toMatchObject({ badge: false, link: false });
    expect(scan(`<a href="https://${HOST}/pledges"><img src="https://${HOST}/api/badges"></a>`)).toMatchObject({ badge: false });
    expect(scan(`<a href="https://${HOST}/pledges"><img src="https://${HOST}/x/api/badge"></a>`)).toMatchObject({ badge: false });
  });
  it('ignores markup that only appears as text, in comments, scripts, styles or textareas', () => {
    const snippet = both();
    expect(scan(`<pre><code>${snippet.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>`)).toMatchObject({ badge: false, link: false });
    expect(scan(`<!-- ${snippet} -->`)).toMatchObject({ badge: false, link: false });
    expect(scan(`<script>document.write('${snippet}')</script>`)).toMatchObject({ badge: false, link: false });
    expect(scan(`<style>/* ${snippet} */</style><textarea>${snippet}</textarea>`)).toMatchObject({ badge: false, link: false });
    expect(scan(`<!-- unclosed ${snippet}`)).toMatchObject({ badge: false, link: false });
  });
  it('reads the title as plain text, at most 80 characters', () => {
    expect(scan(`<title>  Jane &amp; Co  \n Campaign </title>${both()}`).title).toBe('Jane & Co Campaign');
    expect(cleanTitle('<b>Bold</b> <script>x</script>')).toBe('Bold x');
    expect(cleanTitle('A &lt;b&gt; B')).toBe('A b B');
    expect(cleanTitle('x'.repeat(200))).toHaveLength(80);
    expect(cleanTitle('   ')).toBeNull();
    expect(scan(both()).title).toBeNull();
  });
});

describe('robotsAllows', () => {
  it('allows everything when there is no matching rule', () => {
    expect(robotsAllows('', '/')).toBe(true);
    expect(robotsAllows('User-agent: *\nDisallow:\n', '/')).toBe(true);
    expect(robotsAllows('User-agent: Googlebot\nDisallow: /\n', '/')).toBe(true);
  });
  it('obeys the star group and our own group, ours first', () => {
    expect(robotsAllows('User-agent: *\nDisallow: /\n', '/')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow: /private\n', '/private/x')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow: /private\n', '/')).toBe(true);
    expect(robotsAllows('User-agent: *\nDisallow: /\n\nUser-agent: FairMapsBadgeCheck\nAllow: /\n', '/')).toBe(true);
    expect(robotsAllows('User-agent: *\nAllow: /\n\nUser-agent: fairmapsbadgecheck\nDisallow: /\n', '/')).toBe(false);
  });
  it('lets the longest rule win, Allow on a tie, and reads wildcards and comments', () => {
    expect(robotsAllows('User-agent: *\nDisallow: /\nAllow: /about\n', '/about/team')).toBe(true);
    expect(robotsAllows('User-agent: *\nAllow: /a\nDisallow: /a\n', '/a')).toBe(true);
    expect(robotsAllows('User-agent: *\nDisallow: /*.pdf$\n', '/x.pdf')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow: /*.pdf$\n', '/x.pdfx')).toBe(true);
    expect(robotsAllows('# note\nUser-agent: * # everyone\nDisallow: / # all\n', '/')).toBe(false);
  });
});

describe('runBadgeChecks', () => {
  const SNIPPET = `<title>Jane for Senate</title><a href="https://${HOST}/pledges"><img src="https://${HOST}/api/badge"></a>`;
  const html = (body: string) => ({ status: 200, url: 'https://example.com/', contentType: 'text/html; charset=utf-8', body });
  let repo: MemoryRepo;
  let clock: Date;

  const run = async (get: FetchPage, over: Partial<Parameters<typeof runBadgeChecks>[0]> = {}) =>
    runBadgeChecks({ repo, siteHost: HOST, now: () => clock, fetchPage: get, deadline: Date.now() + 60_000, log: () => undefined, ...over });
  const serve = (pages: Record<string, ReturnType<typeof html> | 'error'>, robots = ''): FetchPage => async (url) => {
    if (url.endsWith('/robots.txt')) return { status: robots === '' ? 404 : 200, url, contentType: 'text/plain', body: robots };
    const p = pages[url];
    if (!p || p === 'error') throw new SsrfError('network');
    return { ...p, url: p.url === 'https://example.com/' ? url : p.url };
  };
  const seed = async (url = 'https://example.com/') => {
    await repo.touch(url, new URL(url).hostname, clock.toISOString());
  };
  const nextDay = () => {
    clock = new Date(clock.getTime() + 24 * 3_600_000);
  };

  beforeEach(() => {
    repo = new MemoryRepo();
    clock = new Date(NOW);
  });

  it('verifies a page that shows the badge and links back, and lists it with its title', async () => {
    await seed();
    expect(await run(serve({ 'https://example.com/': html(SNIPPET) }))).toEqual({ checked: 1, verified: 1 });
    expect(repo.rows.get('https://example.com/')).toMatchObject({ verifiedAt: clock.toISOString(), consecutiveFailures: 0, title: 'Jane for Senate' });
    expect((await readBadgeSites(repo, {})).sites.map((s) => s.url)).toEqual(['https://example.com/']);
  });

  it('does not list a page until it is verified', async () => {
    await seed();
    expect((await readBadgeSites(repo, {})).sites).toEqual([]);
  });

  it('does not verify a badge with no link back, or a link with no badge', async () => {
    await seed('https://a.example.com/');
    await seed('https://b.example.com/');
    await run(serve({ 'https://a.example.com/': html(`<img src="https://${HOST}/api/badge">`), 'https://b.example.com/': html(`<a href="https://${HOST}/">x</a>`) }));
    expect((await readBadgeSites(repo, {})).sites).toEqual([]);
    expect(repo.rows.get('https://a.example.com/')).toMatchObject({ verifiedAt: null, consecutiveFailures: 1 });
  });

  it('keeps a site listed after one failed check and unlists it after two in a row', async () => {
    await seed();
    const good = serve({ 'https://example.com/': html(SNIPPET) });
    const bad = serve({ 'https://example.com/': html('<p>gone</p>') });
    await run(good);
    nextDay();
    await run(bad);
    expect(repo.rows.get('https://example.com/')!.consecutiveFailures).toBe(1);
    expect((await readBadgeSites(repo, {})).sites).toHaveLength(1);
    nextDay();
    await run(bad);
    expect(repo.rows.get('https://example.com/')!.consecutiveFailures).toBe(2);
    expect((await readBadgeSites(repo, {})).sites).toEqual([]);
  });

  it('lists a site again once a check passes, and a pass between failures resets the count', async () => {
    await seed();
    const good = serve({ 'https://example.com/': html(SNIPPET) });
    const bad = serve({ 'https://example.com/': 'error' });
    await run(good);
    nextDay();
    await run(bad);
    nextDay();
    await run(good);
    expect(repo.rows.get('https://example.com/')!.consecutiveFailures).toBe(0);
    nextDay();
    await run(bad);
    nextDay();
    await run(bad);
    expect((await readBadgeSites(repo, {})).sites).toEqual([]);
    nextDay();
    await run(good);
    expect((await readBadgeSites(repo, {})).sites).toHaveLength(1);
  });

  it('counts an error, a non-HTML answer and an error status as failed checks', async () => {
    await seed('https://a.example.com/');
    await seed('https://b.example.com/');
    await seed('https://c.example.com/');
    await run(serve({ 'https://a.example.com/': 'error', 'https://b.example.com/': { ...html(SNIPPET), contentType: 'application/pdf' }, 'https://c.example.com/': { ...html(SNIPPET), status: 500 } }));
    for (const h of ['a', 'b', 'c']) expect(repo.rows.get(`https://${h}.example.com/`), h).toMatchObject({ verifiedAt: null, consecutiveFailures: 1 });
  });

  it('treats a page that robots.txt disallows for us as a failed check, without fetching it', async () => {
    await seed();
    let fetched = false;
    const get: FetchPage = async (url) => {
      if (url.endsWith('/robots.txt')) return { status: 200, url, contentType: 'text/plain', body: 'User-agent: *\nDisallow: /\n' };
      fetched = true;
      return html(SNIPPET);
    };
    await run(get);
    expect(fetched).toBe(false);
    expect(repo.rows.get('https://example.com/')).toMatchObject({ verifiedAt: null, consecutiveFailures: 1 });
  });

  it('reads robots.txt once per host per run', async () => {
    await seed('https://example.com/a');
    await seed('https://example.com/b');
    const urls: string[] = [];
    const inner = serve({ 'https://example.com/a': html(SNIPPET), 'https://example.com/b': html(SNIPPET) });
    await run(async (u, a) => {
      urls.push(u);
      return inner(u, a);
    });
    expect(urls.filter((u) => u.endsWith('/robots.txt'))).toHaveLength(1);
  });

  it('fails a check whose page was reached through a redirect to another site, but accepts http to https and www to bare', async () => {
    await seed('https://elsewhere.example.com/');
    await seed('https://moved.example.org/');
    await seed('https://plain.example.net/');
    const logged: string[] = [];
    const get: FetchPage = async (url) => {
      if (url.endsWith('/robots.txt')) return { status: 404, url, contentType: null, body: '' };
      if (url.startsWith('https://elsewhere.')) return { ...html(SNIPPET), url: 'https://someone-famous.example.net/' };
      if (url.startsWith('https://moved.')) return { ...html(SNIPPET), url: 'https://www.moved.example.org/home' };
      return { ...html(SNIPPET), url: url.replace('https://plain.', 'https://www.plain.') };
    };
    await run(get, { log: (c) => logged.push(c) });
    expect(repo.rows.get('https://elsewhere.example.com/')).toMatchObject({ verifiedAt: null, consecutiveFailures: 1 });
    expect(logged).toContain('elsewhere');
    expect(repo.rows.get('https://moved.example.org/')!.verifiedAt).not.toBeNull();
    expect(repo.rows.get('https://plain.example.net/')!.verifiedAt).not.toBeNull();
  });

  it('gives a slow site at most its own time, counts it as failed, and goes on with the others', async () => {
    await seed('https://slow.example.com/');
    await seed('https://fast.example.org/');
    const get: FetchPage = (url) => {
      if (url.endsWith('/robots.txt')) return Promise.resolve({ status: 404, url, contentType: null, body: '' });
      return url.includes('slow.') ? new Promise(() => undefined) : Promise.resolve({ ...html(SNIPPET), url });
    };
    const logged: string[] = [];
    const out = await run(get, { siteCheckMs: 30, log: (c) => logged.push(c) });
    expect(out).toEqual({ checked: 2, verified: 1 });
    expect(logged).toContain('timeout');
    expect(repo.rows.get('https://slow.example.com/')).toMatchObject({ verifiedAt: null, consecutiveFailures: 1 });
  });

  it('deletes old pages before it starts the checks, even when the checks cannot run', async () => {
    await seed('https://old.example.com/');
    clock = new Date(clock.getTime() + 61 * 86_400_000);
    const order: string[] = [];
    const prune = repo.prune.bind(repo);
    repo.prune = async (b) => (order.push('prune'), prune(b));
    await run(async (u) => (order.push('fetch'), serve({})(u)));
    expect(order[0]).toBe('prune');
    expect(repo.rows.size).toBe(0);
    repo.prune = async () => Promise.reject(new Error('db'));
    await seed('https://new.example.com/');
    await expect(run(serve({ 'https://new.example.com/': html(SNIPPET) }))).resolves.toEqual({ checked: 1, verified: 1 });
  });

  it('deletes pages that never passed and have failed twice, and keeps a verified one that is failing', async () => {
    await seed('https://never.example.com/');
    await seed('https://once.example.com/');
    await seed('https://was.example.com/');
    await repo.recordCheck('https://never.example.com/', { checkedAt: clock.toISOString(), consecutiveFailures: 2, verified: null });
    await repo.recordCheck('https://once.example.com/', { checkedAt: clock.toISOString(), consecutiveFailures: 1, verified: null });
    await repo.recordCheck('https://was.example.com/', { checkedAt: clock.toISOString(), consecutiveFailures: 0, verified: { title: null, foundUrl: 'https://was.example.com/' } });
    await repo.recordCheck('https://was.example.com/', { checkedAt: clock.toISOString(), consecutiveFailures: 3, verified: null });
    await run(serve({}));
    expect([...repo.rows.keys()].sort()).toEqual(['https://once.example.com/', 'https://was.example.com/']);
  });

  it('names the checker after the site it runs for', () => {
    expect(checkerUserAgent('fairmaps.melson.us')).toBe('FairMapsBadgeCheck (+https://fairmaps.melson.us/pledges)');
    expect(checkerUserAgent('example.test')).toBe('FairMapsBadgeCheck (+https://example.test/pledges)');
  });

  it('checks at most SITES_PER_RUN per run, never-checked first and then the oldest check, and not a page checked in the last day', async () => {
    expect([SITES_PER_RUN, CHECK_CONCURRENCY, IMMEDIATE_CHECKS_PER_HOUR, RUN_BUDGET_MS]).toEqual([100, 5, 60, 40_000]);
    expect([MAX_SIGHTINGS, MAX_PER_HOST, SITE_CHECK_MS]).toEqual([5000, 3, 8000]);
    const total = SITES_PER_RUN + 5;
    for (let i = 0; i < total; i++) await seed(`https://s${String(i).padStart(3, '0')}.example.com/`);
    const get: FetchPage = async (url) => (url.endsWith('/robots.txt') ? { status: 404, url, contentType: null, body: '' } : { ...html(SNIPPET), url });
    expect((await run(get)).checked).toBe(SITES_PER_RUN);
    expect((await run(get)).checked).toBe(5);
    expect((await run(get)).checked).toBe(0);
    nextDay();
    expect((await run(get)).checked).toBe(SITES_PER_RUN);
  });

  it('does not let old pages starve new ones: never-checked pages go before checked ones, and the oldest check before newer ones', async () => {
    await seed('https://old.example.com/');
    await seed('https://older.example.com/');
    await repo.recordCheck('https://old.example.com/', { checkedAt: '2026-10-20T00:00:00.000Z', consecutiveFailures: 0, verified: null });
    await repo.recordCheck('https://older.example.com/', { checkedAt: '2026-10-10T00:00:00.000Z', consecutiveFailures: 0, verified: null });
    await seed('https://new.example.com/');
    const order: string[] = [];
    await run(async (url) => {
      if (!url.endsWith('/robots.txt')) order.push(new URL(url).hostname);
      return url.endsWith('/robots.txt') ? { status: 404, url, contentType: null, body: '' } : { ...html(SNIPPET), url };
    }, { sitesPerRun: 2 });
    // two slots: the never-checked page and the oldest check; the newer check waits for tomorrow
    expect(order.sort()).toEqual(['new.example.com', 'older.example.com']);
  });

  it('finds the badge on the home page when the stored page no longer has it, and reports the page it was found on', async () => {
    await seed('https://example.com/news/post');
    const pages = { 'https://example.com/news/post': html('<p>moved</p>'), 'https://example.com/': html(SNIPPET) };
    await run(serve(pages));
    expect(repo.rows.get('https://example.com/news/post')).toMatchObject({ foundUrl: 'https://example.com/', consecutiveFailures: 0 });
    expect((await readBadgeSites(repo, {})).sites[0]!.url).toBe('https://example.com/');
  });
  it('reports the stored page itself when the badge is there, and checks the home page only if it must', async () => {
    await seed('https://example.com/news/post');
    const seen: string[] = [];
    const inner = serve({ 'https://example.com/news/post': html(SNIPPET) });
    await run(async (u, a) => {
      seen.push(u);
      return inner(u, a);
    });
    expect(repo.rows.get('https://example.com/news/post')!.foundUrl).toBe('https://example.com/news/post');
    expect(seen.filter((u) => !u.endsWith('/robots.txt'))).toEqual(['https://example.com/news/post']);
    expect((await readBadgeSites(repo, {})).sites[0]!.url).toBe('https://example.com/news/post');
  });
  it('fails when neither the stored page nor the home page has the badge', async () => {
    await seed('https://example.com/news/post');
    await run(serve({ 'https://example.com/news/post': html('<p>x</p>'), 'https://example.com/': html('<p>y</p>') }));
    expect(repo.rows.get('https://example.com/news/post')).toMatchObject({ verifiedAt: null, consecutiveFailures: 1 });
  });

  describe('verifyNow (right after a badge request)', () => {
    const now = (allow: () => Promise<boolean>, get: FetchPage, log: (c: string) => void = () => undefined) => ({ repo, siteHost: HOST, now: () => clock, fetchPage: get, allow, log });

    it('verifies the page and lists it', async () => {
      await seed();
      expect(await verifyNow('https://example.com/', now(async () => true, serve({ 'https://example.com/': html(SNIPPET) })))).toBe('verified');
      expect((await readBadgeSites(repo, {})).sites).toHaveLength(1);
    });
    it('does nothing, and fetches nothing, once the hourly allowance is used up', async () => {
      await seed();
      let fetched = 0;
      const get: FetchPage = async () => {
        fetched++;
        return html(SNIPPET);
      };
      expect(await verifyNow('https://example.com/', now(async () => false, get))).toBe('limited');
      expect(await verifyNow('https://example.com/', now(async () => Promise.reject(new Error('db')), get))).toBe('error');
      expect(fetched).toBe(0);
      expect(repo.rows.get('https://example.com/')).toMatchObject({ lastChecked: null, verifiedAt: null });
    });
    it('does not ask for an allowance for a page that is not in the table', async () => {
      let asked = false;
      expect(await verifyNow('https://nope.example.com/', now(async () => ((asked = true), true), serve({})))).toBe('missing');
      expect(asked).toBe(false);
    });
    it('counts a failed fetch as a failed check, swallows errors, and logs codes only', async () => {
      await seed();
      const logged: string[] = [];
      expect(await verifyNow('https://example.com/', now(async () => true, serve({ 'https://example.com/': 'error' }), (c) => logged.push(c)))).toBe('failed');
      expect(repo.rows.get('https://example.com/')!.consecutiveFailures).toBe(1);
      repo.recordCheck = async () => Promise.reject(new Error('https://secret.example.com'));
      expect(await verifyNow('https://example.com/', now(async () => true, serve({ 'https://example.com/': html(SNIPPET) }), (c) => logged.push(c)))).toBe('error');
      expect(logged.join(' ')).not.toMatch(/example|secret/);
    });
    it('still refuses an address that is not a public https page', async () => {
      repo.rows.set('http://example.com/', { url: 'http://example.com/', host: 'example.com', firstSeen: 'a', lastSeen: 'a', verifiedAt: null, lastChecked: null, consecutiveFailures: 0, title: null, foundUrl: null });
      let fetched = 0;
      expect(await verifyNow('http://example.com/', now(async () => true, async () => (fetched++, html(SNIPPET))))).toBe('failed');
      expect(fetched).toBe(0);
    });
  });

  it('starts no new site after the deadline', async () => {
    await seed();
    expect(await run(serve({ 'https://example.com/': html(SNIPPET) }), { deadline: Date.now() - 1 })).toEqual({ checked: 0, verified: 0 });
  });

  it('forgets pages not seen or verified for 60 days, and keeps a page that is still seen', async () => {
    await seed('https://old.example.com/');
    await seed('https://seen.example.com/');
    clock = new Date(clock.getTime() + 61 * 86_400_000);
    await repo.touch('https://seen.example.com/', 'seen.example.com', clock.toISOString());
    await run(serve({}));
    expect([...repo.rows.keys()]).toEqual(['https://seen.example.com/']);
  });

  it('never throws and logs codes only', async () => {
    await seed();
    const logged: string[] = [];
    const broken = new MemoryRepo();
    broken.dueForCheck = async () => Promise.reject(new Error('https://secret.example.com/?token=abc'));
    await expect(runBadgeChecks({ repo: broken, siteHost: HOST, now: () => clock, fetchPage: serve({}), deadline: Date.now() + 1000, log: (c) => logged.push(c) })).resolves.toEqual({ checked: 0, verified: 0 });
    expect(logged).toEqual(['run']);
    await run(serve({ 'https://example.com/': 'error' }), { log: (c) => logged.push(c) });
    expect(logged.join(' ')).not.toMatch(/example|secret|token/);
  });

  it('refuses to fetch a stored address that is not a public https page', async () => {
    for (const bad of ['http://example.com/', 'https://127.0.0.1/', 'https://example.com:8443/', 'https://user@example.com/']) {
      repo.rows.set(bad, { url: bad, host: 'x', firstSeen: clock.toISOString(), lastSeen: clock.toISOString(), verifiedAt: null, lastChecked: null, consecutiveFailures: 0, title: null, foundUrl: null });
    }
    const fetched: string[] = [];
    await run(async (u) => {
      fetched.push(u);
      return html(SNIPPET);
    });
    expect(fetched).toEqual([]);
    expect([...repo.rows.values()].every((r) => r.verifiedAt === null && r.consecutiveFailures === 1)).toBe(true);
  });
});

describe('readBadgeSites', () => {
  const sighting = (url: string, firstSeen: string, over: Partial<Sighting> = {}): Sighting => ({ url, host: new URL(url).hostname, firstSeen, lastSeen: firstSeen, verifiedAt: firstSeen, lastChecked: firstSeen, consecutiveFailures: 0, title: 'T', foundUrl: url, ...over });

  it('lists verified sites newest first with the shape the page needs, one per host', async () => {
    const repo = new MemoryRepo();
    for (const s of [
      sighting('https://old.example.com/', '2026-10-01T00:00:00.000Z'),
      sighting('https://new.example.com/', '2026-10-20T00:00:00.000Z'),
      sighting('https://www.new.example.com/x', '2026-10-21T00:00:00.000Z'),
      sighting('https://unverified.example.com/', '2026-10-22T00:00:00.000Z', { verifiedAt: null }),
      sighting('https://failing.example.com/', '2026-10-23T00:00:00.000Z', { consecutiveFailures: 2 }),
    ]) repo.rows.set(s.url, s);
    const { sites } = await readBadgeSites(repo, {});
    expect(sites).toEqual([
      { url: 'https://www.new.example.com/x', host: 'www.new.example.com', title: 'T', name: null, office: null, id: null },
      { url: 'https://old.example.com/', host: 'old.example.com', title: 'T', name: null, office: null, id: null },
    ]);
  });

  it('adds a representative name, seat and id when the host is their website host (www ignored) and the badge is on its home page, and nothing else', async () => {
    const repo = new MemoryRepo();
    for (const s of [sighting('https://www.hurd.house.gov/news', '2026-10-20T00:00:00.000Z', { foundUrl: 'https://www.hurd.house.gov/' }), sighting('https://plain.example.com/', '2026-10-19T00:00:00.000Z')]) repo.rows.set(s.url, s);
    const { sites } = await readBadgeSites(repo, { 'hurd.house.gov': { name: 'Jane Hurd', office: 'us-house' as const, state: 'CO', id: 'H1' }, 'constructor': { name: 'X', office: 'us-senate' as const, state: 'CO', id: 'S' } });
    expect(sites[0]).toEqual({ url: 'https://www.hurd.house.gov/', host: 'www.hurd.house.gov', title: 'T', name: 'Jane Hurd', office: 'U.S. House, CO', id: 'H1' });
    expect(sites[1]).toMatchObject({ name: null, office: null });
    expect(Object.keys(sites[0]!).sort()).toEqual(['host', 'id', 'name', 'office', 'title', 'url']);
  });

  it('attaches no name, seat or id when the badge was found on an inner page, or the host is not in the map (shared hosts are left out of it)', async () => {
    const repo = new MemoryRepo();
    const map = { 'hurd.house.gov': { name: 'Jane Hurd', office: 'us-house' as const, state: 'CO', id: 'H1' } };
    for (const s of [sighting('https://hurd.house.gov/supporters/jo', '2026-10-20T00:00:00.000Z'), sighting('https://shared.example.org/', '2026-10-19T00:00:00.000Z')]) repo.rows.set(s.url, s);
    for (const site of (await readBadgeSites(repo, map)).sites) expect(site, site.host).toMatchObject({ name: null, office: null, id: null });
  });

  it('lists at most 200', async () => {
    const repo = new MemoryRepo();
    for (let i = 0; i < 230; i++) {
      const s = sighting(`https://s${i}.example.com/`, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString());
      repo.rows.set(s.url, s);
    }
    expect((await readBadgeSites(repo, {})).sites).toHaveLength(200);
  });
});

describe('badge-sites handler', () => {
  it('answers { sites } with the shared-cache header', async () => {
    const repo = new MemoryRepo();
    repo.rows.set('https://example.com/', { url: 'https://example.com/', host: 'example.com', firstSeen: NOW.toISOString(), lastSeen: NOW.toISOString(), verifiedAt: NOW.toISOString(), lastChecked: NOW.toISOString(), consecutiveFailures: 0, title: 'Home', foundUrl: null });
    const res = await badgeSitesHandler({ repo: () => repo, websites: async () => ({}) })(new Request('https://fairmaps.melson.us/api/badge-sites'));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, s-maxage=300, stale-while-revalidate=600');
    expect(await res.json()).toEqual({ sites: [{ url: 'https://example.com/', host: 'example.com', title: 'Home', name: null, office: null, id: null }] });
  });
  it('answers an error code, not details, when the database fails', async () => {
    const repo = new MemoryRepo();
    repo.listed = async () => Promise.reject(new Error('connection string leaked'));
    const res = await badgeSitesHandler({ repo: () => repo, websites: async () => ({}) })(new Request('https://fairmaps.melson.us/api/badge-sites'));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unavailable' });
  });
});

describe('loadWebsites', () => {
  beforeEach(() => clearWebsitesCache());
  const file = { 'hurd.house.gov': { name: 'Jane Hurd', office: 'us-house', state: 'CO', id: 'H1' } };
  it('reads the published file once for ten minutes and falls back to nothing', async () => {
    let calls = 0;
    const ok = (async () => {
      calls++;
      return Response.json(file);
    }) as typeof fetch;
    let t = 0;
    expect(await loadWebsites('https://site.test', ok, () => t)).toEqual(file);
    t = 9 * 60_000;
    await loadWebsites('https://site.test', ok, () => t);
    expect(calls).toBe(1);
    t = 11 * 60_000;
    await loadWebsites('https://site.test', ok, () => t);
    expect(calls).toBe(2);
    clearWebsitesCache();
    expect(await loadWebsites('https://site.test', (async () => new Response('nope', { status: 404 })) as typeof fetch)).toEqual({});
    clearWebsitesCache();
    expect(await loadWebsites('https://site.test', (async () => Response.json({ x: 1 })) as typeof fetch)).toEqual({});
    clearWebsitesCache();
    expect(await loadWebsites('https://site.test', (async () => Promise.reject(new Error('down'))) as typeof fetch)).toEqual({});
  });
});

describe('badge handler', () => {
  const config = (vercelEnv: string | undefined) => ({ vercelEnv, hashSecret: Buffer.alloc(32, 1), siteOrigin: `https://${HOST}` });
  const rate = () => {
    const attempts: string[] = [];
    return { attempts, repo: { countAttempts: async () => attempts.length, recordAttempt: async (h: string) => void attempts.push(h) } as never };
  };
  const afterWork: Promise<unknown>[] = [];
  const call = (env: string | undefined, referer: string | null, repo: MemoryRepo, r: { repo: never } = rate(), headers: Record<string, string> = {}, extra: Partial<Parameters<typeof badgeHandler>[0]> = {}) =>
    badgeHandler({ loadConfig: () => config(env), rateRepo: () => r.repo, repo: () => repo, now: () => NOW, after: (w) => void afterWork.push(w), fetchPage: async () => Promise.reject(new SsrfError('network')), ...extra })(new Request(`https://${HOST}/api/badge`, { headers: { ...(referer ? { referer } : {}), 'x-real-ip': '203.0.113.7', ...headers } }));

  it('sends the image with an hour of browser caching only, varying by Referer, so shared caches never answer for it', async () => {
    const res = await call('production', 'https://example.com/page?x=1', new MemoryRepo());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
    expect(res.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(res.headers.get('vary')).toBe('Referer');
    expect(await res.text()).toBe(BADGE_SVG);
  });
  it('notes the referring page in production, storing the page address and no visitor data', async () => {
    const repo = new MemoryRepo();
    const r = rate();
    await call('production', 'https://example.com/page?x=1#top', repo, r);
    expect([...repo.rows.values()]).toEqual([{ url: 'https://example.com/page', host: 'example.com', firstSeen: NOW.toISOString(), lastSeen: NOW.toISOString(), verifiedAt: null, lastChecked: null, consecutiveFailures: 0, title: null, foundUrl: null }]);
    expect(r.attempts).toHaveLength(1);
    expect(r.attempts[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify([...repo.rows.values()])).not.toContain('203.0.113.7');
  });
  it('notes nothing outside production, and nothing for our own site', async () => {
    const repo = new MemoryRepo();
    expect((await call('preview', 'https://example.com/', repo)).status).toBe(200);
    expect((await call(undefined, 'https://example.com/', repo)).status).toBe(200);
    await call('production', `https://${HOST}/pledges`, repo);
    await call('production', null, repo);
    expect(repo.rows.size).toBe(0);
  });
  it('still sends the image when the database or the configuration fails', async () => {
    const repo = new MemoryRepo();
    repo.find = async () => Promise.reject(new Error('down'));
    expect((await call('production', 'https://example.com/', repo)).status).toBe(200);
    const res = await badgeHandler({ loadConfig: () => {
        throw new Error('x');
      }, rateRepo: () => rate().repo, repo: () => repo, now: () => NOW, after: () => undefined })(new Request(`https://${HOST}/api/badge`));
    expect(res.status).toBe(200);
  });
  describe('immediate verification', () => {
    const SNIP = `<a href="https://${HOST}/pledges"><img src="https://${HOST}/api/badge"></a>`;
    const page = async (url: string) => ({ status: 200, url, contentType: 'text/html', body: SNIP });
    const keyed = () => {
      const byKey = new Map<string, number>();
      return { byKey, repo: { countAttempts: async (k: string) => byKey.get(k) ?? 0, recordAttempt: async (k: string) => void byKey.set(k, (byKey.get(k) ?? 0) + 1) } as never };
    };
    const drain = async () => {
      await Promise.all(afterWork.splice(0));
    };

    it('checks a new page after the response through waitUntil, and lists it', async () => {
      const repo = new MemoryRepo();
      afterWork.length = 0;
      const res = await call('production', 'https://example.com/news?x=1', repo, keyed() as never, {}, { fetchPage: async (u) => (u.endsWith('/robots.txt') ? { status: 404, url: u, contentType: null, body: '' } : page(u)) });
      expect(res.status).toBe(200);
      expect(afterWork).toHaveLength(1);
      expect(repo.rows.get('https://example.com/news')!.verifiedAt).toBeNull();
      await drain();
      expect(repo.rows.get('https://example.com/news')).toMatchObject({ foundUrl: 'https://example.com/news', consecutiveFailures: 0 });
      expect((await readBadgeSites(repo, {})).sites).toHaveLength(1);
    });
    it('does not schedule a check for our own site, a page seen within the hour, or outside production', async () => {
      const repo = new MemoryRepo();
      afterWork.length = 0;
      await call('production', `https://${HOST}/pledges`, repo);
      await call('preview', 'https://example.com/', repo);
      expect(afterWork).toHaveLength(0);
      await call('production', 'https://example.com/', repo);
      await call('production', 'https://example.com/', repo);
      expect(afterWork).toHaveLength(1);
      await drain();
    });
    it('stops after 60 immediate checks in an hour across the whole site, counted in the shared allowance table', async () => {
      const repo = new MemoryRepo();
      const r = keyed();
      let fetched = 0;
      const fetchPage = async (u: string) => (u.endsWith('/robots.txt') ? { status: 404, url: u, contentType: null, body: '' } : (fetched++, page(u)));
      afterWork.length = 0;
      // different visitors (networks) so the per-visitor limit never gets in the way
      for (let i = 0; i < IMMEDIATE_CHECKS_PER_HOUR + 10; i++) await call('production', `https://s${i}.example.com/`, repo, r as never, { 'x-real-ip': `203.0.${i}.9` }, { fetchPage });
      await drain();
      expect(fetched).toBe(IMMEDIATE_CHECKS_PER_HOUR);
      expect(repo.rows.size).toBe(IMMEDIATE_CHECKS_PER_HOUR + 10);
      expect([...repo.rows.values()].filter((x) => x.lastChecked === null)).toHaveLength(10);
    });
    it('logs a code only, once, when the table is full, and still sends the image', async () => {
      const repo = new MemoryRepo();
      repo.count = async () => MAX_SIGHTINGS;
      const errors: string[] = [];
      const spy = vi.spyOn(console, 'error').mockImplementation((m: string) => void errors.push(m));
      const res = await call('production', 'https://example.com/', repo);
      spy.mockRestore();
      expect(res.status).toBe(200);
      expect(errors).toEqual([JSON.stringify({ code: 'badge-full' })]);
      expect(repo.rows.size).toBe(0);
    });
    it('swallows every error in the background work', async () => {
      const repo = new MemoryRepo();
      afterWork.length = 0;
      await call('production', 'https://example.com/', repo, keyed() as never, {}, { fetchPage: async () => Promise.reject(new Error('boom')) });
      await expect(drain()).resolves.toBeUndefined();
      expect(repo.rows.get('https://example.com/')).toMatchObject({ consecutiveFailures: 1 });
      const broken = new MemoryRepo();
      broken.recordCheck = async () => Promise.reject(new Error('db'));
      await call('production', 'https://example.com/', broken, keyed() as never, {}, { fetchPage: async (u) => page(u) });
      await expect(drain()).resolves.toBeUndefined();
    });
  });
  it('stops writing for a visitor network that is over the limit', async () => {
    const repo = new MemoryRepo();
    const r = { attempts: [] as string[], repo: { countAttempts: async () => 5, recordAttempt: async () => undefined } as never };
    await call('production', 'https://example.com/', repo, r);
    expect(repo.rows.size).toBe(0);
  });
});
