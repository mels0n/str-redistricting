// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const published = { engine: '1.2.3', input: { vintage: 'census-2020', revision: 3, sha256: 'c'.repeat(64) }, maps: 7, schema: '1.0.0', web: '9.9.9', docs: '1.0.0' };

const respond = (status: number, body: unknown): typeof fetch => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('site footer', () => {
  it('claims no versions before the data is stamped: only a changelog link', async () => {
    vi.stubGlobal('fetch', respond(404, {}));
    const { createSiteFooter } = await import('../../src/client/widgets/site-footer');
    const el = createSiteFooter();
    await settle();
    expect(el.textContent).toBe('Changelog');
    const links = el.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe('#/changelog');
  });

  it('stays a bare link when the published versions file is invalid', async () => {
    vi.stubGlobal('fetch', respond(200, { maps: 'one' }));
    const { createSiteFooter } = await import('../../src/client/widgets/site-footer');
    const el = createSiteFooter();
    await settle();
    expect(el.textContent).toBe('Changelog');
  });

  it('names the published release, engine and input, with the code’s own site version', async () => {
    vi.stubGlobal('fetch', respond(200, published));
    const { createSiteFooter } = await import('../../src/client/widgets/site-footer');
    const { VERSIONS, censusLabel } = await import('../../src/client/shared');
    const el = createSiteFooter();
    await settle();
    const expected = `Maps release 7 · Engine 1.2.3 · ${censusLabel('census-2020')} (r3) · Site ${VERSIONS.web}`;
    expect(el.textContent).toBe(expected);
    expect(el.querySelectorAll('a')[0]!.getAttribute('href')).toBe('#/changelog');
    expect(expected).not.toContain('—');
  });
});
