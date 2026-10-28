// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadgeSitesSchema, loadBadgeSites, resetBadgeSites, siteForWebsite, type BadgeSite } from '../../src/client/entities/badge-sites';

const site = (host: string, url = `https://${host}/`): BadgeSite => ({ url, host, title: null, name: null, office: null });

describe('siteForWebsite', () => {
  const sites = [site('hurd.example.gov', 'https://hurd.example.gov/about'), site('www.other.example.org')];
  it('matches on the host, ignoring www, case and the path', () => {
    expect(siteForWebsite(sites, 'https://www.hurd.example.gov/news')?.url).toBe('https://hurd.example.gov/about');
    expect(siteForWebsite(sites, 'HTTP://OTHER.example.org')?.host).toBe('www.other.example.org');
  });
  it('matches nothing for another host, a sub-domain, an empty or bad address', () => {
    for (const w of ['https://example.gov/', 'https://x.hurd.example.gov/', '', null, undefined, 'not a url']) expect(siteForWebsite(sites, w), String(w)).toBeUndefined();
  });
});

describe('BadgeSitesSchema', () => {
  it('takes the server shape and refuses anything else', () => {
    expect(BadgeSitesSchema.safeParse({ sites: [site('a.example.org')] }).success).toBe(true);
    expect(BadgeSitesSchema.safeParse({ sites: [{ ...site('a.example.org'), url: 'javascript:alert(1)' }] }).success).toBe(false);
    expect(BadgeSitesSchema.safeParse({ sites: [{ ...site('a.example.org'), party: 'x' }] }).success).toBe(false);
  });
});

describe('loadBadgeSites', () => {
  afterEach(() => {
    resetBadgeSites();
    vi.unstubAllGlobals();
  });
  it('reads /api/badge-sites once and shares the answer', async () => {
    const fetchMock = vi.fn(async (_url: string) => Response.json({ sites: [site('a.example.org')] }));
    vi.stubGlobal('fetch', fetchMock);
    const [a, b] = await Promise.all([loadBadgeSites(), loadBadgeSites()]);
    expect(a).toEqual(b);
    expect(a).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/badge-sites');
  });
  it('answers null on an error status, bad data or a network failure, and tries again next time', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 503 })));
    expect(await loadBadgeSites()).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ nope: 1 })));
    expect(await loadBadgeSites()).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    expect(await loadBadgeSites()).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ sites: [] })));
    expect(await loadBadgeSites()).toEqual([]);
  });
});
