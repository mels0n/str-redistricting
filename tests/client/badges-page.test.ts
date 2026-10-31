// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAGE_META, config } from '../../src/client/shared';
import { badgeAssets, badgeSnippet, BADGE_SNIPPET, type BadgeChoice } from '../../src/client/features/badge-snippet';
import { createBadgesPage, badgeCard, type FrameDeps } from '../../src/client/pages/badges';
import type { StateIndex } from '../../src/client/entities/state';
import { createPledgesPage } from '../../src/client/pages/pledges';
import { createPrivacyPage } from '../../src/client/pages/privacy';

const IDS = ['crest', 'seal', 'pledge', 'button'] as const;
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('badges page', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('has the heading, the intro with its two links and a card per badge', () => {
    const page = createBadgesPage();
    expect(page.el.querySelector('h1')!.textContent).toBe('Badges for candidates');
    expect(page.focusTarget()?.textContent).toBe('Badges for candidates');
    expect(document.title).toBe(PAGE_META.badges.title);
    expect(PAGE_META.badges.title).toBe('Badges for candidates | Fair Maps');
    const lede = page.el.querySelector('.strv-how__lede')!;
    expect(lede.textContent).toBe('Put a Fair Maps badge on your campaign site. Each one is a picture with a link back here, with no script. When a page shows a badge, we note that page’s address, never who visited, and list the site on Sites that show the badge.');
    expect(lede.textContent).not.toContain('nothing is tracked');
    const hrefs = Object.fromEntries([...lede.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]));
    expect(hrefs).toEqual({ 'never who visited': '/privacy', 'Sites that show the badge': '/pledges' });
    expect(page.el.querySelectorAll('.strv-badges__card')).toHaveLength(6);
    const section = page.el.querySelector('.strv-badges__state')!;
    expect(section.querySelector('h2')!.textContent).toBe('A badge for your state');
    expect(section.getAttribute('aria-labelledby')).toBe(section.querySelector('h2')!.id);
    expect(section.querySelector(':scope > p')!.textContent).toBe('Pick your state, then the chamber. Each badge shows our map for it and links to that map.');
    expect(page.el.textContent).not.toContain('—');
  });

  it('shows each snippet, preview and downloads from the badge assets', () => {
    const page = createBadgesPage();
    const cards = [...page.el.querySelectorAll('.strv-badges__card')];
    IDS.forEach((id, i) => {
      const card = cards[i]!;
      const choice: BadgeChoice = { id, theme: 'light' };
      const a = badgeAssets(choice, config.siteHost);
      expect(card.querySelector<HTMLTextAreaElement>('textarea[readonly]')!.value).toBe(badgeSnippet(choice, config.siteHost));
      const img = card.querySelector('img')!;
      expect(img.getAttribute('src')).toBe(a.previewImage);
      expect(img.getAttribute('src')).toMatch(/^\/api\/badge/);
      expect(img.getAttribute('alt')).toBe(a.alt);
      expect([...card.querySelectorAll('.strv-badges__downloads a')].map((l) => [l.textContent, l.getAttribute('href')])).toEqual(a.downloads.map((d) => [d.label, d.href]));
      const title = card.querySelector('h2')!.textContent;
      expect([...card.querySelectorAll('.strv-badges__downloads a')].map((l) => l.getAttribute('aria-label'))).toEqual(a.downloads.map((d) => `${title}, ${d.label}`));
      expect(card.querySelector<HTMLTextAreaElement>('textarea')!.defaultValue).toBe(badgeSnippet(choice, config.siteHost));
    });
  });

  it('keeps the live button snippet for the light button', () => {
    const page = createBadgesPage();
    const button = page.el.querySelectorAll('.strv-badges__card')[3]!;
    expect(button.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(BADGE_SNIPPET);
  });

  it('swaps the preview, the snippet and the downloads with the light and dark switch', () => {
    const page = createBadgesPage();
    const card = page.el.querySelectorAll('.strv-badges__card')[0]!;
    const [light, dark] = [...card.querySelectorAll<HTMLButtonElement>('.strv-badges__switch button')];
    expect(light!.getAttribute('aria-pressed')).toBe('true');
    expect(dark!.getAttribute('aria-pressed')).toBe('false');
    dark!.click();
    const choice: BadgeChoice = { id: 'crest', theme: 'dark' };
    const a = badgeAssets(choice, config.siteHost);
    expect(dark!.getAttribute('aria-pressed')).toBe('true');
    expect(light!.getAttribute('aria-pressed')).toBe('false');
    expect(card.querySelector('img')!.getAttribute('src')).toBe(a.previewImage);
    expect(card.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(badgeSnippet(choice, config.siteHost));
    expect([...card.querySelectorAll('.strv-badges__downloads a')].map((l) => l.getAttribute('href'))).toEqual(a.downloads.map((d) => d.href));
    light!.click();
    expect(card.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(badgeSnippet({ id: 'crest', theme: 'light' }, config.siteHost));
  });

  it('copies the snippet and says so', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const page = createBadgesPage();
    const card = page.el.querySelectorAll('.strv-badges__card')[1]!;
    const copy = [...card.querySelectorAll('button')].find((b) => b.textContent === 'Copy')!;
    copy.click();
    await flush();
    expect(writeText).toHaveBeenCalledWith(badgeSnippet({ id: 'seal', theme: 'light' }, config.siteHost));
    expect(copy.textContent).toBe('Copied');
  });

  it('selects the text and asks for a hand copy when the clipboard refuses', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('blocked'))) } });
    const page = createBadgesPage();
    document.body.append(page.el);
    const card = page.el.querySelectorAll('.strv-badges__card')[0]!;
    const copy = [...card.querySelectorAll('button')].find((b) => b.textContent === 'Copy')!;
    copy.click();
    await flush();
    const box = card.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(box.selectionStart).toBe(0);
    expect(box.selectionEnd).toBe(box.value.length);
    expect(copy.textContent).toBe('Select and copy');
  });

  it('lets a card follow a changing choice through refresh', () => {
    let choice: BadgeChoice = { id: 'crest', theme: 'light' };
    const card = badgeCard(() => choice, 'Test');
    choice = { id: 'seal', theme: 'light' };
    card.refresh();
    expect(card.el.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(badgeSnippet({ id: 'seal', theme: 'light' }, config.siteHost));
  });
});

const summary = {
  population: 1000,
  ideal: 125,
  rangePersons: 1,
  rangePct: 0.1,
  allContiguous: true,
  assignmentSha256: 'a'.repeat(64),
  inputSha256: 'b'.repeat(64),
  lineSearch: 'exact',
};
const stubIndex: StateIndex = {
  states: [
    { abbr: 'CO', name: 'Colorado', seats: 8, hasData: true, summary, chambers: { 'state-house': { seats: 65, hasData: true, summary }, 'state-senate': { seats: 35, hasData: true, summary } } },
    { abbr: 'NE', name: 'Nebraska', seats: 3, hasData: true, summary, chambers: { 'state-house': { seats: 0, hasData: false }, 'state-senate': { seats: 49, hasData: true, summary } } },
    { abbr: 'VT', name: 'Vermont', seats: 1, hasData: true, summary, chambers: { 'state-house': { seats: 150, hasData: true, summary }, 'state-senate': { seats: 30, hasData: false } } },
  ],
};

describe('state badge picker', () => {
  const PROMPT = 'Choose your state to see its badge';
  const mount = async () => {
    const page = createBadgesPage(() => Promise.resolve(stubIndex));
    document.body.append(page.el);
    await flush();
    const state = page.el.querySelector<HTMLSelectElement>('select[aria-label="Your state"]')!;
    const chamber = page.el.querySelector<HTMLSelectElement>('select[aria-label="Chamber"]')!;
    const cards = () => [...page.el.querySelectorAll('.strv-badges__card')].slice(4);
    const pick = (el: HTMLSelectElement, v: string) => {
      el.value = v;
      el.dispatchEvent(new Event('change'));
    };
    return { page, state, chamber, cards, pick };
  };
  const options = (el: HTMLSelectElement) => [...el.options].map((o) => o.value);

  it('renders before the index loads, with the prompt and no state images', () => {
    const page = createBadgesPage(() => new Promise(() => undefined));
    const cards = [...page.el.querySelectorAll('.strv-badges__card')].slice(4);
    expect(cards).toHaveLength(2);
    for (const c of cards) {
      expect(c.textContent).toContain(PROMPT);
      expect(c.querySelector('img')).toBeNull();
    }
    const state = page.el.querySelector<HTMLSelectElement>('select[aria-label="Your state"]')!;
    expect(state.options[0]!.textContent).toBe('Choose your state');
  });

  it('shows the prompt and no image until a state is picked', async () => {
    const { cards, state } = await mount();
    expect(options(state)).toEqual(['', 'CO', 'NE', 'VT']);
    for (const c of cards()) {
      expect(c.textContent).toContain(PROMPT);
      expect(c.querySelector('img')).toBeNull();
    }
  });

  it('shows the US House badge and a chamber badge for Colorado', async () => {
    const { cards, state, chamber, pick } = await mount();
    pick(state, 'CO');
    const [house, chamberCard] = cards();
    const a = badgeAssets({ id: 'state', theme: 'light', abbr: 'CO', stateName: 'Colorado', chamber: 'federal-house', seats: 8 }, config.siteHost);
    expect(house!.querySelector('img')!.getAttribute('src')).toBe(`/api/badge?badge=state&state=CO`);
    expect(a.downloads[0]!.href).toContain('/data/CO/badge@2x.png');
    expect([...house!.querySelectorAll('.strv-badges__downloads a')].map((l) => l.getAttribute('href'))).toEqual(a.downloads.map((d) => d.href));
    expect(house!.querySelector('textarea')!.value).toContain('/CO"');
    expect(options(chamber)).toEqual(['state-house', 'state-senate']);
    expect(chamberCard!.querySelector('img')!.getAttribute('src')).toBe(`/api/badge?badge=state&state=CO&chamber=house`);
    pick(chamber, 'state-senate');
    expect(chamberCard!.querySelector('img')!.getAttribute('src')).toBe(`/api/badge?badge=state&state=CO&chamber=senate`);
    expect([...chamberCard!.querySelectorAll('.strv-badges__downloads a')].map((l) => l.getAttribute('href'))).toEqual([expect.stringContaining('/data/CO/state-senate/badge@2x.png')]);
  });

  it('offers only states with a published map for the chosen chamber', async () => {
    const { state, chamber, pick, cards } = await mount();
    pick(state, 'CO');
    pick(chamber, 'state-senate');
    expect(options(state)).toEqual(['', 'CO', 'NE', 'VT']);
    pick(state, 'NE');
    expect(cards()[0]!.querySelector('img')!.getAttribute('src')).toBe(`/api/badge?badge=state&state=NE`);
    expect(cards()[1]!.querySelector('img')!.getAttribute('src')).toBe(`/api/badge?badge=state&state=NE&chamber=senate`);
    pick(chamber, 'state-house');
    expect(options(state)).toEqual(['', 'CO', 'NE', 'VT']);
    expect(state.value).toBe('NE');
    expect(cards()[0]!.querySelector('img')).not.toBeNull();
    expect(cards()[1]!.querySelector('img')).toBeNull();
    expect(cards()[1]!.textContent).toContain('Nebraska has one legislative chamber, its Senate. There is no State House to draw.');
    expect(cards()[1]!.textContent).not.toContain('No map published yet');
  });

  it('says a chamber has no map once a state is picked, and keeps the prompt before', async () => {
    const { state, chamber, pick, cards } = await mount();
    pick(state, 'VT');
    pick(chamber, 'state-senate');
    expect(state.value).toBe('VT');
    const none = cards()[1]!;
    expect(none.textContent).toContain('No map published yet for this chamber.');
    expect(none.textContent).not.toContain('Choose your state');
    expect(none.querySelector('img')).toBeNull();
    expect(none.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('');
    expect([...none.querySelectorAll('button')].find((b) => b.textContent === 'Copy')!.disabled).toBe(true);
    expect(cards()[0]!.querySelector('img')).not.toBeNull();
  });

  it('titles the second card after the chamber and links to its page', async () => {
    const { state, chamber, pick, cards } = await mount();
    pick(state, 'CO');
    const card = cards()[1]!;
    expect(card.querySelector('h2')!.textContent).toBe('State House');
    expect(card.querySelector('textarea')!.getAttribute('aria-label')).toBe('HTML for the State House badge');
    expect(card.querySelector('textarea')!.value).toContain('/CO/house"');
    pick(chamber, 'state-senate');
    expect(card.querySelector('h2')!.textContent).toBe('State Senate');
    expect(card.querySelector('.strv-badges__switch')!.getAttribute('aria-label')).toBe('State Senate colors');
    expect(card.querySelector('textarea')!.value).toContain('/CO/senate"');
  });

  it('tells the visitor when the state list does not load', async () => {
    const page = createBadgesPage(() => Promise.reject(new Error('offline')));
    await flush();
    expect(page.el.querySelector('.strv-badges__note')!.textContent).toBe('The list of states didn’t load. Reload the page to try again.');
  });
});

describe('pages that point at the badges page', () => {
  it('links /pledges to /badges and keeps the button snippet', () => {
    const page = createPledgesPage([]);
    const link = [...page.el.querySelectorAll('a')].find((a) => a.textContent === 'Badges for candidates')!;
    expect(link.getAttribute('href')).toBe('/badges');
    expect(page.el.textContent).toContain('More badges, including one with your state’s map: Badges for candidates');
    expect(page.el.querySelector('pre')!.textContent).toBe(BADGE_SNIPPET);
    expect(page.el.textContent).toContain(`What we look for: any of our badges (an image from ${config.siteHost}/api/badge) and a link to ${config.siteHost} on the same page.`);
  });

  it('names the privacy badge section and says one of our badges', () => {
    const page = createPrivacyPage();
    expect(page.el.querySelector('#strv-privacy-badge')).not.toBeNull();
    expect(page.el.querySelector('#strv-privacy-badge')!.textContent).toContain('If a website shows one of our badges');
  });
});

describe('profile photo frame', () => {
  const NEVER = () => new Promise<never>(() => undefined);
  const setup = (over: Partial<FrameDeps> = {}) => {
    const draws: unknown[][] = [];
    const ctx = {
      fillStyle: '',
      fillRect: (...a: unknown[]) => void draws.push(['fill', ctx.fillStyle, ...a]),
      drawImage: (...a: unknown[]) => void draws.push(a),
    };
    const canvas = document.createElement('canvas');
    (canvas as unknown as { getContext: () => unknown }).getContext = () => ctx;
    (canvas as unknown as { toBlob: (cb: (b: Blob | null) => void) => void }).toBlob = (cb) => cb(new Blob(['x'], { type: 'image/png' }));
    const photo = { width: 2000, height: 1000, close: vi.fn() } as unknown as ImageBitmap;
    const ring = { ring: true } as unknown as CanvasImageSource;
    const decode = vi.fn(async () => photo);
    const deps: FrameDeps = { decode, loadRing: async () => ring, makeCanvas: () => canvas, ...over };
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const xhr = vi.fn();
    vi.stubGlobal('XMLHttpRequest', xhr);
    let n = 0;
    const create = vi.fn(() => `blob:fair-${++n}`);
    const revoke = vi.fn();
    URL.createObjectURL = create;
    URL.revokeObjectURL = revoke;
    const page = createBadgesPage(NEVER, deps);
    document.body.append(page.el);
    const input = page.el.querySelector<HTMLInputElement>('input[type="file"]')!;
    const choose = async (file: File) => {
      Object.defineProperty(input, 'files', { value: [file], configurable: true });
      input.dispatchEvent(new Event('change'));
      await flush();
    };
    return { page, input, choose, draws, canvas, photo, ring, decode, fetchSpy, xhr, create, revoke };
  };
  const pic = (size = 10, type = 'image/jpeg') => {
    const f = new File(['x'], 'me.jpg', { type });
    Object.defineProperty(f, 'size', { value: size });
    return f;
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('offers the ring downloads and a photo input, and is not a badge card', () => {
    const { page, input } = setup();
    const frame = page.el.querySelector('.strv-badges__frame')!;
    expect([...frame.querySelectorAll('a[download]')].map((a) => a.getAttribute('href'))).toEqual(['/badges/frame.png', '/badges/frame-print.png']);
    expect(input.getAttribute('accept')).toBe('image/*');
    expect(frame.textContent).toContain('Use my photo');
    expect(frame.textContent).toContain('Your photo stays on your device. It is never uploaded.');
    expect(frame.querySelector('textarea')).toBeNull();
    expect(page.el.querySelectorAll('.strv-badges__card')).toHaveLength(6);
    expect(page.el.textContent).not.toContain('—');
  });

  it('refuses a file that is not a picture and draws nothing', async () => {
    const { page, choose, draws, decode } = setup();
    await choose(pic(10, 'application/pdf'));
    expect(page.el.querySelector('.strv-badges__frame .strv-badges__note')!.textContent).toBe('That file isn’t a picture. Choose a JPG or PNG.');
    expect(draws).toHaveLength(0);
    expect(decode).not.toHaveBeenCalled();
  });

  it('refuses a picture over 20 MB', async () => {
    const { page, choose, draws } = setup();
    await choose(pic(20 * 1024 * 1024 + 1));
    expect(page.el.querySelector('.strv-badges__frame .strv-badges__note')!.textContent).toBe('That picture is too large. Choose one under 20 MB.');
    expect(draws).toHaveLength(0);
  });

  it('says it is not a picture when the file will not decode', async () => {
    const { page, choose, draws } = setup({ decode: async () => Promise.reject(new Error('bad')) });
    await choose(pic());
    expect(page.el.querySelector('.strv-badges__frame .strv-badges__note')!.textContent).toContain('isn’t a picture');
    expect(draws).toHaveLength(0);
  });

  it('draws the photo center-cropped under the ring and offers the download without any request', async () => {
    const { page, choose, draws, canvas, photo, ring, fetchSpy, xhr } = setup();
    await choose(pic());
    expect(canvas.width).toBe(1080);
    expect(canvas.height).toBe(1080);
    expect(draws).toEqual([
      ['fill', '#F3EFE5', 0, 0, 1080, 1080],
      [photo, 500, 0, 1000, 1000, 0, 0, 1080, 1080],
      [ring, 0, 0, 1080, 1080],
    ]);
    const link = page.el.querySelector<HTMLAnchorElement>('.strv-badges__frame a[download="fair-maps-photo.png"]')!;
    expect(link.textContent).toBe('Download my photo');
    expect(link.getAttribute('href')).toMatch(/^blob:/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
  });

  it('closes the decoded photo after drawing it', async () => {
    const { choose, photo } = setup();
    await choose(pic());
    expect(photo.close).toHaveBeenCalledTimes(1);
  });

  it('never shows a stale photo, and closes it', async () => {
    const stale = { width: 10, height: 10, close: vi.fn() } as unknown as ImageBitmap;
    let release!: (b: ImageBitmap) => void;
    const first = new Promise<ImageBitmap>((r) => (release = r));
    const { choose, page, draws, photo } = setup();
    const decode = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(photo);
    page.destroy?.();
    document.body.replaceChildren();
    const s = setup({ decode });
    await s.choose(pic());
    await s.choose(pic());
    expect(s.page.el.querySelectorAll('a[download="fair-maps-photo.png"]')).toHaveLength(1);
    const drawn = s.draws.length;
    release(stale);
    await flush();
    expect(s.draws).toHaveLength(drawn);
    expect(stale.close).toHaveBeenCalledTimes(1);
    expect(draws).toHaveLength(0);
  });

  it('reports a failed drawing and closes the photo', async () => {
    const { page, choose, photo } = setup({ loadRing: async () => Promise.reject(new Error('x')) });
    await choose(pic());
    expect(page.el.querySelector('.strv-badges__frame .strv-badges__note')!.textContent).toBe('Couldn’t make the picture. Try again.');
    expect(photo.close).toHaveBeenCalledTimes(1);
  });

  it('reports a picture that could not be encoded', async () => {
    const c = document.createElement('canvas');
    (c as unknown as { getContext: () => unknown }).getContext = () => ({ drawImage: () => undefined });
    (c as unknown as { toBlob: (cb: (b: Blob | null) => void) => void }).toBlob = (cb) => cb(null);
    const { page, choose, photo } = setup({ makeCanvas: () => c });
    await choose(pic());
    expect(page.el.querySelector('.strv-badges__frame .strv-badges__note')!.textContent).toBe('Couldn’t make the picture. Try again.');
    expect(photo.close).toHaveBeenCalledTimes(1);
  });

  it('treats a missing 2d context as a failure', async () => {
    const c = document.createElement('canvas');
    (c as unknown as { getContext: () => unknown }).getContext = () => null;
    const { page, choose } = setup({ makeCanvas: () => c });
    await choose(pic());
    expect(page.el.querySelector('.strv-badges__frame .strv-badges__note')!.textContent).toBe('Couldn’t make the picture. Try again.');
    expect(page.el.querySelector('a[download="fair-maps-photo.png"]')).toBeNull();
  });

  it('revokes the earlier address for a new photo and on destroy', async () => {
    const { page, choose, revoke } = setup();
    await choose(pic());
    await choose(pic());
    expect(revoke).toHaveBeenCalledWith('blob:fair-1');
    page.destroy?.();
    expect(revoke).toHaveBeenCalledWith('blob:fair-2');
  });
});
