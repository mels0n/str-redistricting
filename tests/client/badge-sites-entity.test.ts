// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadgeSitesSchema, loadBadgeSites, resetBadgeSites, siteForRep, type BadgeSite } from '../../src/client/entities/badge-sites';

const site = (host: string, url = `https://${host}/`): BadgeSite => ({ url, host, title: null, name: null, office: null, id: null });

describe('siteForRep', () => {
  const sites = [{ ...site('hurd.example.gov', 'https://hurd.example.gov/'), id: 'H1' }, site('plain.example.org')];
  it('matches only on the representative id', () => {
    expect(siteForRep(sites, 'H1')?.host).toBe('hurd.example.gov');
    expect(siteForRep(sites, 'H2')).toBeUndefined();
    expect(siteForRep(sites, '')).toBeUndefined();
  });
  it('never matches a site that carries no id, whatever its host', () => {
    expect(siteForRep([site('hurd.example.gov')], 'H1')).toBeUndefined();
  });
});

describe('BadgeSitesSchema', () => {
  it('takes the server shape and refuses anything else', () => {
    expect(BadgeSitesSchema.safeParse({ sites: [site('a.example.org')] }).success).toBe(true);
    expect(BadgeSitesSchema.safeParse({ sites: [{ ...site('a.example.org'), url: 'javascript:alert(1)' }] }).success).toBe(false);
    expect(BadgeSitesSchema.safeParse({ sites: [{ ...site('a.example.org'), party: 'x' }] }).success).toBe(false);
    const { id: _id, ...noId } = site('a.example.org');
    expect(BadgeSitesSchema.safeParse({ sites: [noId] }).success).toBe(false);
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
