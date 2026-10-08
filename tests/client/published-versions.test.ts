// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const published = { engine: '1.2.3', input: { vintage: 'census-2020', revision: 3, sha256: 'c'.repeat(64) }, maps: 7, schema: '1.0.0', web: '9.9.9', docs: '1.0.0' };
const respond = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('loadPublishedVersions', () => {
  it('returns the published versions file', async () => {
    respond(200, published);
    const { loadPublishedVersions } = await import('../../src/client/shared');
    expect(await loadPublishedVersions()).toMatchObject({ maps: 7, engine: '1.2.3' });
  });
  it('is null on a 404', async () => {
    respond(404, {});
    const { loadPublishedVersions } = await import('../../src/client/shared');
    expect(await loadPublishedVersions()).toBeNull();
  });
  it('is null on an invalid file', async () => {
    respond(200, { ...published, maps: 'seven' });
    const { loadPublishedVersions } = await import('../../src/client/shared');
    expect(await loadPublishedVersions()).toBeNull();
  });
});
