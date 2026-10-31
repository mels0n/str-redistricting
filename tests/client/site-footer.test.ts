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
  it('claims no versions before the data is stamped', async () => {
    vi.stubGlobal('fetch', respond(404, {}));
    const { createSiteFooter } = await import('../../src/client/widgets/site-footer');
    const el = createSiteFooter();
    await settle();
    expect(el.querySelector<HTMLElement>('.strv-footer__versions')!.hidden).toBe(true);
    expect(el.querySelectorAll('a')[0]!.getAttribute('href')).toBe('/changelog');
  });

  it('stays quiet about versions when the published versions file is invalid', async () => {
    vi.stubGlobal('fetch', respond(200, { maps: 'one' }));
    const { createSiteFooter } = await import('../../src/client/widgets/site-footer');
    const el = createSiteFooter();
    await settle();
    expect(el.querySelector<HTMLElement>('.strv-footer__versions')!.hidden).toBe(true);
  });

  it('names the published release, engine and input, with the code’s own site version', async () => {
    vi.stubGlobal('fetch', respond(200, published));
    const { createSiteFooter } = await import('../../src/client/widgets/site-footer');
    const { VERSIONS, censusLabel } = await import('../../src/client/shared');
    const el = createSiteFooter();
    await settle();
    const expected = `Maps release 7 · Engine 1.2.3 · ${censusLabel('census-2020')} (r3) · Site ${VERSIONS.web}`;
    const line = el.querySelector<HTMLElement>('.strv-footer__versions')!;
    expect(line.hidden).toBe(false);
    expect(line.textContent).toBe(expected);
    expect(el.querySelectorAll('a')[0]!.getAttribute('href')).toBe('/changelog');
    expect(expected).not.toContain('—');
  });

  it('links a question and a problem report to their GitHub issue forms, and the changelog and privacy pages', async () => {
    vi.stubGlobal('fetch', respond(404, {}));
    const { createSiteFooter } = await import('../../src/client/widgets/site-footer');
    const el = createSiteFooter();
    const hrefs = [...el.querySelectorAll('.strv-footer__links a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/changelog', 'https://github.com/mels0n/str-redistricting/issues/new?template=question.yml', 'https://github.com/mels0n/str-redistricting/issues/new?template=problem.yml', '/badges', '/privacy']);
    expect([...el.querySelectorAll('a')].map((a) => a.textContent)).toEqual(['Changelog', 'Ask a question', 'Report a problem on GitHub', 'Badges for candidates', 'Privacy']);
    expect(hrefs).not.toContain('/remove');
  });
});
