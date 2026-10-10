import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { affectedBy, diffSources, hashRemote, probeSource, SourcesSchema } from '../../../src/server/features/census-watch/index.js';

const rec = (extra: object = {}) => ({ url: 'https://x.test/a.zip', etag: '"abc"', lastModified: 'Mon, 01 Jan 2024 00:00:00 GMT', contentLength: 100, ...extra });

describe('diffSources', () => {
  it('reports nothing for identical sources', () => {
    expect(diffSources({ 'a.zip': rec() }, { 'a.zip': rec() })).toEqual({ changed: [], unknown: [] });
  });
  it('flags an etag change', () => {
    expect(diffSources({ 'a.zip': rec() }, { 'a.zip': rec({ etag: '"def"' }) }).changed).toEqual(['a.zip']);
  });
  it('flags a content-length change', () => {
    expect(diffSources({ 'a.zip': rec() }, { 'a.zip': rec({ contentLength: 101 }) }).changed).toEqual(['a.zip']);
  });
  it('flags a last-modified change', () => {
    expect(diffSources({ 'a.zip': rec() }, { 'a.zip': rec({ lastModified: 'Tue, 02 Jan 2024 00:00:00 GMT' }) }).changed).toEqual(['a.zip']);
  });
  it('is unknown when the observed response has no headers', () => {
    const bare = { url: 'https://x.test/a.zip' };
    expect(diffSources({ 'a.zip': rec() }, { 'a.zip': bare })).toEqual({ changed: [], unknown: ['a.zip'] });
  });
  it('is unknown when the recorded entry has no headers', () => {
    expect(diffSources({ 'a.zip': { url: 'u' } }, { 'a.zip': rec() })).toEqual({ changed: [], unknown: ['a.zip'] });
  });
  it('is unknown when the two share no header', () => {
    expect(diffSources({ 'a.zip': { url: 'u', etag: '"a"' } }, { 'a.zip': { url: 'u', contentLength: 5 } }).unknown).toEqual(['a.zip']);
  });
  it('is unknown when a recorded file was not observed, or an observed file was never recorded', () => {
    expect(diffSources({ 'a.zip': rec() }, {})).toEqual({ changed: [], unknown: ['a.zip'] });
    expect(diffSources({}, { 'b.zip': rec() })).toEqual({ changed: [], unknown: ['b.zip'] });
  });
  it('lets one matching header stand when another is missing on one side', () => {
    expect(diffSources({ 'a.zip': rec() }, { 'a.zip': { url: 'u', etag: '"abc"' } })).toEqual({ changed: [], unknown: [] });
  });
});

describe('SourcesSchema', () => {
  it('rejects unknown keys and bad lengths', () => {
    expect(SourcesSchema.safeParse({ 'a.zip': { url: 'u', contentLength: -1 } }).success).toBe(false);
    expect(SourcesSchema.safeParse({ 'a.zip': { url: 'u', extra: 1 } }).success).toBe(false);
    expect(SourcesSchema.safeParse({ 'a.zip': rec() }).success).toBe(true);
  });
});

describe('affectedBy', () => {
  it('maps tabblock files to state abbreviations and cb_ files to display files', () => {
    expect(affectedBy(['tl_2020_08_tabblock20.zip', 'tl_2020_44_tabblock20.zip', 'cb_2025_us_state_20m.zip'])).toEqual({ states: ['CO', 'RI'], display: true });
    expect(affectedBy(['tl_2020_08_tabblock20.zip'])).toEqual({ states: ['CO'], display: false });
  });
});

describe('probeSource', () => {
  it('sends the project User-Agent and honors Retry-After', async () => {
    const sleeps: number[] = [];
    const f = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '5' } }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    await probeSource('https://x.test/a.zip', { fetchFn: f, sleep: async (ms) => void sleeps.push(ms) });
    expect(sleeps).toEqual([5000]);
    expect((f.mock.calls[0]?.[1]?.headers as Record<string, string>)['User-Agent']).toBe('str-redistricting (+https://github.com/mels0n/str-redistricting)');
  });
  it('reads etag, last-modified and content-length from a HEAD response', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(null, { status: 200, headers: { etag: '"e"', 'last-modified': 'L', 'content-length': '12' } }));
    expect(await probeSource('https://x.test/a.zip', { fetchFn, sleep: async () => undefined })).toEqual({ url: 'https://x.test/a.zip', etag: '"e"', lastModified: 'L', contentLength: 12 });
    expect(fetchFn.mock.calls[0]![1]?.method).toBe('HEAD');
  });
  it('omits absent headers and fails on a 404', async () => {
    const bare = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
    expect(await probeSource('u', { fetchFn: bare, sleep: async () => undefined })).toEqual({ url: 'u' });
    const gone = vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }));
    await expect(probeSource('u', { fetchFn: gone, sleep: async () => undefined })).rejects.toThrow(/404/);
  });
  it('retries a 503 then succeeds', async () => {
    const fetchFn = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { etag: '"e"' } }));
    expect((await probeSource('u', { fetchFn, sleep: async () => undefined })).etag).toBe('"e"');
  });
});

describe('hashRemote', () => {
  it('streams to a temp dir, returns the sha256 and leaves nothing behind', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cw-test-'));
    const fetchFn = vi.fn<typeof fetch>(async () => new Response('hello', { status: 200 }));
    const sha = await hashRemote('https://www2.census.gov/a.zip', 'a.zip', { fetchFn, sleep: async () => undefined, tmpRoot: root });
    expect(sha).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(readdirSync(root)).toEqual([]);
  });
});
