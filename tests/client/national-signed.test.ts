// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

async function mount(counts: { national: number; waiting: number }, search = '') {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => (String(url).includes('/api/counts') ? Response.json({ state: 0, byKey: {}, ...counts }) : new Response('{}', { status: 404 }))));
  const shared = await import('../../src/client/shared');
  shared.captureSigned(search);
  const { createNationalPage } = await import('../../src/client/pages/national');
  const page = createNationalPage(() => undefined);
  await settle();
  return page;
}

beforeEach(() => void 0);
afterEach(() => vi.unstubAllGlobals());

describe('national page signed line', () => {
  it.each([
    [{ national: 1000, waiting: 0 }, '1,000 people have signed'],
    [{ national: 1234, waiting: 0 }, '1,234 people have signed'],
    [{ national: 1234, waiting: 5 }, '1,234 people have signed 5 more waiting to confirm'],
  ])('%j', async (counts, text) => {
    const page = await mount(counts);
    const line = page.el.querySelector('.strv-national__signed') as HTMLElement;
    expect(line.hidden).toBe(false);
    expect(line.textContent?.replace(/\s+/g, ' ').trim()).toBe(text);
    page.destroy();
  });

  it.each([[{ national: 999, waiting: 5 }], [{ national: 1, waiting: 0 }]])('shows nothing below the display threshold: %j', async (counts) => {
    const page = await mount(counts);
    expect((page.el.querySelector('.strv-national__signed') as HTMLElement).hidden).toBe(true);
    expect(page.el.textContent).not.toContain('have signed');
    expect(page.el.textContent).not.toContain('waiting to confirm');
    page.destroy();
  });

  it('shows nothing when the counts fail to load', async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    const { createNationalPage } = await import('../../src/client/pages/national');
    const page = createNationalPage(() => undefined);
    await settle();
    expect((page.el.querySelector('.strv-national__signed') as HTMLElement).hidden).toBe(true);
    page.destroy();
  });

  it('shows no waiting number without a total', async () => {
    const page = await mount({ national: 0, waiting: 5 });
    expect((page.el.querySelector('.strv-national__signed') as HTMLElement).hidden).toBe(true);
    expect(page.el.textContent).not.toContain('waiting to confirm');
    page.destroy();
  });
});

describe('national page link notices', () => {
  it.each([
    ['?signed=expired', 'That link has expired. Sign again to get a new one.'],
    ['?signed=invalid', 'That link was already used or isn’t valid.'],
  ])('%s', async (search, text) => {
    const page = await mount({ national: 0, waiting: 0 }, search);
    expect(page.el.textContent).toContain(text);
    page.destroy();
  });
});
