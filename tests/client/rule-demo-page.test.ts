// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const FILE = {
  version: 1,
  cases: [
    {
      id: 'cut.share',
      state: 'AL',
      stateName: 'Alabama',
      source: { cut: 1 },
      link: { state: 'AL', cut: 1 },
      view: { w: 320, h: 180 },
      labels: [{ id: 'pop', x: 160, y: 60, text: '5,024,279 people' }],
      steps: [
        { caption: 'S1', show: ['pop'] },
        { caption: 'S2', show: ['pop'] },
        { caption: 'S3', show: ['pop'] },
      ],
    },
    {
      id: 'strays.fixed',
      state: 'CO',
      stateName: 'Colorado',
      source: {},
      link: { state: 'CO' },
      view: { w: 320, h: 180 },
      labels: [{ id: 'a', x: 160, y: 60, text: 'a' }],
      steps: [
        { caption: 'T1', show: ['a'] },
        { caption: 'T2', show: ['a'] },
        { caption: 'T3', show: ['a'] },
      ],
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
    expect(page.el.querySelectorAll('figure.strv-rule-demo').length).toBe(2);
    expect(page.el.querySelector('figure.strv-rule-demo a')!.textContent).toBe('Open Alabama at cut 1');
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
    expect(d.querySelector('.strv-rule-demo__status')!.textContent).toBe('Could not load the examples Try again');
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

  it('a panel that fails to build leaves no half-filled set, and Try again fills each slot once', async () => {
    stubFetch(() => true);
    let fail = true;
    vi.doMock('../../src/client/widgets/rule-demo', async (orig) => {
      const real = await orig<typeof import('../../src/client/widgets/rule-demo')>();
      return {
        ...real,
        createRuleDemo: (c: Parameters<typeof real.createRuleDemo>[0]) => {
          if (fail && c.id === 'strays.fixed') throw new Error('cannot draw');
          return real.createRuleDemo(c);
        },
      };
    });
    const page = await newPage();
    const all = [...page.el.querySelectorAll<HTMLDetailsElement>('details.strv-how__more')];
    const both = all.find((x) => x.querySelector('[data-case="cut.share"]') && x.querySelector('[data-case="strays.fixed"]'));
    const target = both ?? all.find((x) => x.querySelector('[data-case="strays.fixed"]'))!;
    open(target);
    await flush();
    expect(target.querySelectorAll('figure.strv-rule-demo').length).toBe(0);
    fail = false;
    target.querySelector<HTMLButtonElement>('.strv-rule-demo__status button')!.click();
    await flush();
    const filled = [...target.querySelectorAll<HTMLElement>('[data-case]')].filter((slot) => slot.querySelector('figure.strv-rule-demo'));
    expect(filled.length).toBeGreaterThan(0);
    for (const slot of filled) expect(slot.querySelectorAll('figure.strv-rule-demo').length).toBe(1);
    page.destroy();
    vi.doUnmock('../../src/client/widgets/rule-demo');
  });

  it('registers each wired case id once', async () => {
    stubFetch(() => true);
    const page = await newPage();
    const { exactCaseIds } = await import('../../src/client/pages/how/ui');
    const ids = exactCaseIds(page.el);
    expect(ids).toContain('cut.share');
    expect(ids).toContain('balance.ideal');
    expect(ids).toContain('fingerprint.repeat');
    expect(ids.length).toBe(new Set(ids).size);
    page.destroy();
  });
});

class FakeObserver {
  static all: FakeObserver[] = [];
  watched = new Set<Element>();
  disconnected = false;
  constructor(private cb: (e: { target: Element; isIntersecting: boolean }[]) => void) {
    FakeObserver.all.push(this);
  }
  observe(el: Element): void {
    this.watched.add(el);
  }
  disconnect(): void {
    this.disconnected = true;
    this.watched.clear();
  }
  show(el: Element, isIntersecting: boolean): void {
    this.cb([{ target: el, isIntersecting }]);
  }
}

describe('How page playback gating', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeObserver.all = [];
    vi.stubGlobal('IntersectionObserver', FakeObserver);
  });
  afterEach(() => vi.useRealTimers());

  const settle = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(0);
  };
  // jsdom queues its own toggle event on a timer; let it run so only the panels' timers are left to count.
  const setOpen = async (d: HTMLDetailsElement, v: boolean): Promise<void> => {
    d.open = v;
    d.dispatchEvent(new Event('toggle'));
    await settle();
  };
  const counterOf = (d: HTMLElement): string => d.querySelector('.strv-rule-demo__count')!.textContent ?? '';
  const obsFor = (d: HTMLElement): FakeObserver => FakeObserver.all.find((o) => [...o.watched].some((w) => d.contains(w)))!;
  const panel = (d: HTMLElement): HTMLElement => d.querySelector<HTMLElement>('figure.strv-rule-demo')!;

  it('plays on open once in view, pauses on leaving view and on close, and reopening leaves one timer', async () => {
    stubFetch(() => true);
    const page = await newPage();
    const base = vi.getTimerCount();
    const d = page.el.querySelector<HTMLDetailsElement>('details.strv-how__more')!;
    open(d);
    await settle();
    expect(vi.getTimerCount()).toBe(base);
    expect(counterOf(d)).toBe('Step 1 of 3');
    const obs = obsFor(d);
    obs.show(panel(d), true);
    expect(vi.getTimerCount()).toBe(base + 1);
    await vi.advanceTimersByTimeAsync(2200);
    expect(counterOf(d)).toBe('Step 2 of 3');

    obs.show(panel(d), false);
    expect(vi.getTimerCount()).toBe(base);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(counterOf(d)).toBe('Step 2 of 3');

    obs.show(panel(d), true);
    await setOpen(d, false);
    expect(vi.getTimerCount()).toBe(base);
    await setOpen(d, true);
    await setOpen(d, false);
    await setOpen(d, true);
    expect(vi.getTimerCount()).toBe(base + 1);
    page.destroy();
  });

  it('a panel that played to its end, or was paused, does not restart when it scrolls back into view', async () => {
    stubFetch(() => true);
    const page = await newPage();
    const base = vi.getTimerCount();
    const d = page.el.querySelector<HTMLDetailsElement>('details.strv-how__more')!;
    open(d);
    await settle();
    const obs = obsFor(d);
    obs.show(panel(d), true);
    await vi.advanceTimersByTimeAsync(2200 * 3);
    expect(counterOf(d)).toBe('Step 3 of 3');
    expect(vi.getTimerCount()).toBe(base);
    obs.show(panel(d), false);
    obs.show(panel(d), true);
    expect(vi.getTimerCount()).toBe(base);
    expect(counterOf(d)).toBe('Step 3 of 3');
    page.destroy();
  });

  it('runs two open panels independently and tears everything down on destroy', async () => {
    stubFetch(() => true);
    const page = await newPage();
    const base = vi.getTimerCount();
    const [a, b] = [...page.el.querySelectorAll<HTMLDetailsElement>('details.strv-how__more')];
    const second = [...page.el.querySelectorAll<HTMLDetailsElement>('details.strv-how__more')].find((x) => x.querySelector('[data-case="strays.fixed"]'))!;
    open(a!);
    open(second);
    await settle();
    expect(b).toBeTruthy();
    obsFor(a!).show(panel(a!), true);
    await vi.advanceTimersByTimeAsync(2200);
    obsFor(second).show(panel(second), true);
    expect(counterOf(a!)).toBe('Step 2 of 3');
    expect(counterOf(second)).toBe('Step 1 of 3');
    await vi.advanceTimersByTimeAsync(2200);
    expect(counterOf(a!)).toBe('Step 3 of 3');
    expect(counterOf(second)).toBe('Step 2 of 3');
    expect(vi.getTimerCount()).toBe(base + 1);

    page.destroy();
    expect(vi.getTimerCount()).toBe(base);
    expect(FakeObserver.all.filter((o) => !o.disconnected).length).toBe(0);
  });
});

describe('How page: why a district can look strange', () => {
  it('is the last section, listed in the contents, with no em dash', async () => {
    stubFetch(() => true);
    const page = await newPage();
    const sections = [...page.el.querySelectorAll('section.strv-how__section')];
    const last = sections[sections.length - 1]!;
    expect(last.id).toBe('strv-how-strange');
    expect(last.querySelector('h2')?.textContent).toContain('Why does my district look strange?');
    expect(last.querySelector('a[href="#/CO/cut/1"]')?.textContent).toBe('starting with Colorado’s first cut');
    expect(page.el.querySelector('.strv-how__toc a[data-section="strange"]')).not.toBeNull();
    expect(last.textContent).toContain('Nobody chose any single line.');
    expect(last.textContent).not.toContain('—');
  });
});
