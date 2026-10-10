// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const stamp = { engine: '1.0.0', input: { vintage: 'census-2020', revision: 1, sha256: 'c'.repeat(64) }, maps: 4, schema: '1.0.0' };
const summary = { population: 100, ideal: 12.5, rangePersons: 1, rangePct: 0, allContiguous: true, assignmentSha256: 'a'.repeat(64), inputSha256: 'b'.repeat(64), lineSearch: 'exact' };
const index = (versions: unknown) => ({ states: [{ abbr: 'CO', name: 'Colorado', seats: 8, hasData: true, summary: { ...summary, ...(versions ? { versions } : {}) } }] });

const serve = (body: unknown | null) =>
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).endsWith('index.json') && body !== null ? new Response(JSON.stringify(body)) : new Response('{}', { status: 404 }))));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const recipe = (el: HTMLElement): string => el.querySelector('pre.strv-code')?.textContent ?? '';

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe('how page reproduce recipe', () => {
  it('pins the clone to the maps release in the published data, not the bundled one', async () => {
    serve(index(stamp));
    const { createHowPage } = await import('../../src/client/pages/how');
    const page = createHowPage({ page: 'how', section: null });
    expect(recipe(page.el)).not.toContain('--branch');
    await settle();
    expect(recipe(page.el)).toContain('git clone --branch maps-4 --depth 1');
    page.destroy();
  });

  it('stays unpinned when the published state carries no stamp', async () => {
    serve(index(null));
    const { createHowPage } = await import('../../src/client/pages/how');
    const page = createHowPage({ page: 'how', section: null });
    await settle();
    expect(recipe(page.el)).not.toContain('--branch');
    expect(recipe(page.el)).toContain('--states CO');
    page.destroy();
  });

  it('stays unpinned and does not crash when the index fails to load', async () => {
    serve(null);
    const { createHowPage } = await import('../../src/client/pages/how');
    const page = createHowPage({ page: 'how', section: null });
    await settle();
    expect(recipe(page.el)).not.toContain('--branch');
    page.destroy();
  });
});
