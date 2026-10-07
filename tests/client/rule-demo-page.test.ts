// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const FILE = {
  version: 1,
  cases: [
    {
      id: 'cut.share',
      state: 'AL',
      source: { cut: 1 },
      link: { state: 'AL', cut: 1 },
      view: { w: 320, h: 180 },
      labels: [{ id: 'pop', x: 160, y: 60, text: '5,024,279 people' }],
      steps: [{ caption: 'The share.', show: ['pop'] }],
    },
  ],
};

let fetchCalls: string[] = [];
function stubFetch(ok: () => boolean): void {
  vi.stubGlobal('fetch', (url: string) => {
    fetchCalls.push(String(url));
    if (!String(url).includes('rule-examples')) return new Promise(() => {});
    return ok() ? Promise.resolve(new Response(JSON.stringify(FILE))) : Promise.resolve(new Response('no', { status: 500 }));
  });
}

async function newPage() {
  const { createHowPage } = await import('../../src/client/pages/how');
  return createHowPage({ page: 'how', section: null });
}
const open = (d: HTMLDetailsElement): void => {
  d.open = true;
  d.dispatchEvent(new Event('toggle'));
};
const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};
const ruleCalls = (): number => fetchCalls.filter((u) => u.includes('rule-examples')).length;

beforeEach(() => {
  vi.resetModules();
  fetchCalls = [];
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});
afterEach(() => vi.unstubAllGlobals());

describe('How page rule demos', () => {
  it('opening two expanders fetches once', async () => {
    stubFetch(() => true);
    const page = await newPage();
    const [a, b] = [...page.el.querySelectorAll<HTMLDetailsElement>('details.strv-how__more')];
    open(a!);
    open(b!);
    await flush();
    expect(ruleCalls()).toBe(1);
    expect(page.el.querySelectorAll('figure.strv-rule-demo').length).toBe(1);
    page.destroy();
  });

  it('failed fetch shows Try again, which refetches', async () => {
    let good = false;
    stubFetch(() => good);
    const page = await newPage();
    const d = page.el.querySelector<HTMLDetailsElement>('details.strv-how__more')!;
    open(d);
    await flush();
    expect(ruleCalls()).toBe(1);
    const retry = [...d.querySelectorAll('button')].find((b) => b.textContent === 'Try again')!;
    expect(retry).toBeTruthy();
    good = true;
    retry.click();
    await flush();
    expect(ruleCalls()).toBe(2);
    expect([...d.querySelectorAll('button')].some((b) => b.textContent === 'Try again')).toBe(false);
    page.destroy();
  });

  it('a case id missing from the file leaves the slot empty', async () => {
    stubFetch(() => true);
    const page = await newPage();
    const all = [...page.el.querySelectorAll<HTMLDetailsElement>('details.strv-how__more')];
    const d = all.find((x) => x.querySelector('[data-case="cut.globe"]'))!;
    open(d);
    await flush();
    expect(d.querySelector('[data-case="cut.globe"]')!.childElementCount).toBe(0);
    expect(d.querySelector('[data-case="cut.share"]')!.querySelector('figure')).not.toBeNull();
    page.destroy();
  });

  it('registers each wired case id once', async () => {
    stubFetch(() => true);
    const page = await newPage();
    const { EXACT_CASE_IDS } = await import('../../src/client/pages/how/ui');
    expect(EXACT_CASE_IDS).toContain('cut.share');
    expect(EXACT_CASE_IDS).toContain('balance.ideal');
    expect(EXACT_CASE_IDS).toContain('fingerprint.repeat');
    expect(EXACT_CASE_IDS.length).toBe(new Set(EXACT_CASE_IDS).size);
    page.destroy();
  });
});
