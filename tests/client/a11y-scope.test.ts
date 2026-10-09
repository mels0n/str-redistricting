// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const css = readFileSync('src/client/app/styles.css', 'utf8');
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
});
afterEach(() => vi.unstubAllGlobals());

describe('page titles share the site suffix', () => {
  it('changelog', async () => {
    const { createChangelogPage } = await import('../../src/client/pages/changelog');
    createChangelogPage({ maps: '# Maps\n', engine: '# Engine\n', input: '# Input\n' });
    expect(document.title).toBe('Changelog | Fair House Maps');
  });

  it('how it works', async () => {
    const { createHowPage } = await import('../../src/client/pages/how');
    const page = createHowPage({ page: 'how', section: null });
    await settle();
    expect(document.title).toBe('How the districts are drawn | Fair House Maps');
    page.destroy();
  });
});

describe('contrast tokens', () => {
  it('--rule is never a text color (3.1:1 on the ground)', () => {
    expect(css).not.toMatch(/^\s*color:\s*var\(--rule\)/m);
  });
});

describe('forced colors', () => {
  const block = css.slice(css.indexOf('@media (forced-colors: active)'));
  it('restates focus, the US map, the scrubber and buttons in system colors', () => {
    expect(block).toContain('outline: 3px solid Highlight');
    expect(block).toMatch(/\.strv-us__state:hover path,\s*\.strv-us__state:focus-visible path\s*\{[^}]*fill: Highlight/);
    expect(block).toMatch(/\.strv-scrub__range::-webkit-slider-thumb/);
    expect(block).toMatch(/\.strv-button[\s\S]*border: 1px solid ButtonText/);
    expect(block).toMatch(/\.strv-map-label\[data-selected='true'\]/);
  });
});

describe('address search copy', () => {
  it('asks for a street address and says a PO box cannot be placed, in the field note and the no-match message', async () => {
    const { createAddressSearch } = await import('../../src/client/features/address-search');
    const search = createAddressSearch({ id: 'a', onFound: () => undefined });
    expect(search.el.textContent).toMatch(/street address; a PO box cannot be placed/);
    const { describeError, GeocodeError } = await import('../../src/client/shared');
    expect(describeError(new GeocodeError('no-match'))).toMatch(/street address: a PO box cannot be placed/);
  });

  it('explains why D.C. and the territories have no map', async () => {
    const { describeResolution } = await import('../../src/client/features/address-search/resolve');
    const text = describeResolution({ kind: 'outside' }, { matchedAddress: '1 MAIN ST', state: 'DC' } as never);
    expect(text).toMatch(/not in one of the 50 states/);
    expect(text).toMatch(/non-voting delegates/);
  });
});

describe('scope note', () => {
  it('is on the national page and the how page', async () => {
    const { createNationalPage } = await import('../../src/client/pages/national');
    const national = createNationalPage(() => undefined);
    expect(national.el.textContent).toMatch(/cover the 50 states.*non-voting delegates/);
    national.destroy();
    const { createHowPage } = await import('../../src/client/pages/how');
    const how = createHowPage({ page: 'how', section: null });
    expect(how.el.textContent).toMatch(/cover the 50 states.*non-voting delegates/);
    how.destroy();
  });
});
