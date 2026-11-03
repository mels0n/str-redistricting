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
    expect(page.el.querySelector('h1')!.textContent).toBe('Fair Maps badges');
    expect(page.focusTarget()?.textContent).toBe('Fair Maps badges');
    expect(document.title).toBe(PAGE_META.badges.title);
    expect(PAGE_META.badges.title).toBe('Badges | Fair Maps');
    expect(page.el.querySelector('.strv-how__lede')!.textContent).toBe('Show that you back fair maps. Put the Fair Maps ring on your profile picture, or a badge on your website or campaign site.');
    const site = page.el.querySelector('.strv-badges__site')!;
    expect(site.querySelector('h2')!.textContent).toBe('For your website');
    const intro = site.querySelector('p')!;
    expect(intro.textContent).toBe('Each badge is a picture with a link back here, with no script. When a page shows a badge, we note that page’s address, never who visited, and list the site on Sites that show the badge.');
    expect(page.el.textContent).not.toContain('nothing is tracked');
    expect(page.el.textContent).not.toContain('candidates');
    const hrefs = Object.fromEntries([...intro.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]));
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
    expect(page.el.querySelector('.strv-badges__state .strv-badges__note')!.textContent).toBe('The list of states didn’t load. Reload the page to try again.');
  });
});

describe('pages that point at the badges page', () => {
  it('links /pledges to /badges and keeps the button snippet', () => {
    const page = createPledgesPage([]);
    const link = [...page.el.querySelectorAll('a')].find((a) => a.textContent === 'Badges')!;
    expect(link.getAttribute('href')).toBe('/badges');
    expect(page.el.textContent).toContain('More badges, including one with your state’s map and a ring for your profile picture: Badges');
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
    expect([...frame.querySelectorAll('textarea')].map((t) => t.id)).toEqual(['strv-badges-post']);
    expect(page.el.querySelectorAll('.strv-badges__card')).toHaveLength(6);
    expect(page.el.textContent).not.toContain('—');
  });

  it('shows the ring itself until a photo is chosen, comes first on the page, and never shows an empty box', () => {
    const { page } = setup();
    const frame = page.el.querySelector('.strv-badges__frame')!;
    const ring = frame.querySelector<HTMLImageElement>('.strv-badges__preview img')!;
    expect(ring.getAttribute('src')).toBe('/badges/frame.png');
    expect(ring.getAttribute('alt')).toBe('The Fair Maps ring');
    expect(ring.className).toBe('strv-badges__ring');
    expect([ring.getAttribute('width'), ring.getAttribute('height')]).toEqual(['240', '240']);
    expect(frame.querySelector('h2')!.textContent).toBe('Profile picture ring');
    const sections = [...page.el.querySelectorAll('.strv-badges__frame, .strv-badges__site, .strv-badges__state')].map((e) => e.className);
    expect(sections).toEqual(['strv-badges__frame', 'strv-badges__site', 'strv-badges__state']);
  });

  it('refuses a file that is not a picture, draws nothing and shows the ring again', async () => {
    const { page, choose, draws, decode } = setup();
    await choose(pic(10, 'application/pdf'));
    expect(page.el.querySelector('.strv-badges__frame .strv-badges__note')!.textContent).toBe('That file isn’t a picture. Choose a JPG or PNG.');
    expect(page.el.querySelector('.strv-badges__frame .strv-badges__preview img')!.getAttribute('src')).toBe('/badges/frame.png');
    expect(draws).toHaveLength(0);
    expect(decode).not.toHaveBeenCalled();
  });

  it('refuses a picture over 20 MB', async () => {
    const { page, choose, draws } = setup();
    await choose(pic(20 * 1024 * 1024 + 1));
    expect(page.el.querySelector('.strv-badges__frame .strv-badges__note')!.textContent).toBe('That picture is too large. Choose one under 20 MB.');
    expect(draws).toHaveLength(0);
  });

  const ringOnly = (page: { el: HTMLElement }) => {
    const preview = page.el.querySelector('.strv-badges__frame .strv-badges__preview')!;
    expect(preview.querySelector('canvas')).toBeNull();
    expect(preview.querySelector('a[download]')).toBeNull();
    expect(preview.querySelector('img')!.getAttribute('src')).toBe('/badges/frame.png');
  };

  it('takes the finished photo and its download away as soon as another photo is chosen', async () => {
    const decode = vi.fn().mockResolvedValueOnce({ width: 10, height: 10, close: vi.fn() }).mockReturnValueOnce(NEVER());
    const { page, choose } = setup({ decode });
    await choose(pic());
    expect(page.el.querySelector('a[download="fair-maps-photo.png"]')).not.toBeNull();
    await choose(pic());
    ringOnly(page);
  });

  it.each([
    ['a file that is not a picture', {}, () => pic(10, 'application/pdf')],
    ['a picture over 20 MB', {}, () => pic(20 * 1024 * 1024 + 1)],
    ['a file that will not decode', { bad: true }, () => pic()],
  ])('shows the ring again after a good photo and then %s', async (_n, opt, file) => {
    const good = { width: 10, height: 10, close: vi.fn() } as unknown as ImageBitmap;
    const decode = 'bad' in opt ? vi.fn().mockResolvedValueOnce(good).mockRejectedValueOnce(new Error('bad')) : vi.fn(async () => good);
    const { page, choose } = setup({ decode });
    await choose(pic());
    expect(page.el.querySelector('.strv-badges__preview canvas')).not.toBeNull();
    await choose(file());
    ringOnly(page);
  });

  it('shows the ring again after a drawing fails', async () => {
    const { page, choose } = setup({ loadRing: async () => Promise.reject(new Error('x')) });
    await choose(pic());
    ringOnly(page);
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

  it('keeps the photo open while it can be adjusted, and closes it for another photo or when the page goes', async () => {
    const { page, choose, photo } = setup();
    await choose(pic());
    expect(photo.close).not.toHaveBeenCalled();
    await choose(pic());
    expect(photo.close).toHaveBeenCalledTimes(1);
    page.destroy?.();
    expect(photo.close).toHaveBeenCalledTimes(2);
  });

  it('gives a line to post with a link back to the badges page, and a button that copies it', async () => {
    const { page } = setup();
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const post = page.el.querySelector<HTMLTextAreaElement>('#strv-badges-post')!;
    expect(post.value).toBe(`I support fair maps. Get the ring for your profile picture at https://${config.siteHost}/badges`);
    expect(post.defaultValue).toBe(post.value);
    expect(page.el.querySelector('label[for="strv-badges-post"]')).not.toBeNull();
    post.parentElement!.querySelector<HTMLButtonElement>('#strv-badges-post ~ button')!.click();
    await flush();
    expect(writeText).toHaveBeenCalledWith(post.value);
  });

  describe('adjusting the photo', () => {
    const lastPhotoDraw = (draws: unknown[][], photo: ImageBitmap) => draws.filter((d) => d[0] === photo).at(-1)!.slice(1, 5);
    const ready = async () => {
      const s = setup();
      await s.choose(pic());
      const zoom = s.page.el.querySelector<HTMLInputElement>('#strv-badges-zoom')!;
      const link = s.page.el.querySelector<HTMLAnchorElement>('a[download="fair-maps-photo.png"]')!;
      return { ...s, zoom, link };
    };

    it('zooms in about the center and never past four times', async () => {
      const { zoom, draws, photo } = await ready();
      zoom.value = '2';
      zoom.dispatchEvent(new Event('input'));
      expect(lastPhotoDraw(draws, photo)).toEqual([750, 250, 500, 500]);
      zoom.value = '9';
      zoom.dispatchEvent(new Event('input'));
      expect(lastPhotoDraw(draws, photo)[2]).toBe(250);
    });

    it('moves with a drag and stays inside the photo', async () => {
      const { canvas, draws, photo } = await ready();
      const ptr = (type: string, x: number, y = 0) => canvas.dispatchEvent(Object.assign(new MouseEvent(type, { clientX: x, clientY: y }), { pointerId: 1 }));
      // jsdom lays nothing out, so a screen pixel counts as a canvas pixel: 1080 across shows 1000 photo pixels.
      ptr('pointerdown', 500);
      ptr('pointermove', 392);
      expect(lastPhotoDraw(draws, photo)).toEqual([600, 0, 1000, 1000]);
      ptr('pointermove', -5000);
      expect(lastPhotoDraw(draws, photo)).toEqual([1000, 0, 1000, 1000]);
      ptr('pointerup', -5000);
      ptr('pointermove', 5000);
      expect(lastPhotoDraw(draws, photo)).toEqual([1000, 0, 1000, 1000]);
    });

    it('moves the photo the way an arrow key points', async () => {
      const { canvas, draws, photo } = await ready();
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true }));
      expect(lastPhotoDraw(draws, photo)).toEqual([460, 0, 1000, 1000]);
      const e = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true });
      canvas.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
      expect(lastPhotoDraw(draws, photo)).toEqual([500, 0, 1000, 1000]);
    });

    it('downloads the photo as it is now, never an earlier position', async () => {
      const { zoom, link, create, revoke } = await ready();
      expect(link.getAttribute('href')).toBe('blob:fair-1');
      zoom.value = '2';
      zoom.dispatchEvent(new Event('input'));
      const click = new MouseEvent('click', { cancelable: true });
      link.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(true);
      await flush();
      expect(create).toHaveBeenCalledTimes(2);
      expect(revoke).toHaveBeenCalledWith('blob:fair-1');
      expect(link.getAttribute('href')).toBe('blob:fair-2');
      const again = new MouseEvent('click', { cancelable: true });
      link.dispatchEvent(again);
      expect(again.defaultPrevented).toBe(false);
    });

    /** Hold each encode until the test releases it, so encodes can overlap and finish in any order. */
    const holdEncodes = (canvas: HTMLCanvasElement) => {
      const pending: ((b: Blob | null) => void)[] = [];
      (canvas as unknown as { toBlob: (cb: (b: Blob | null) => void) => void }).toBlob = (cb) => void pending.push(cb);
      return pending;
    };
    const zoomTo = (zoom: HTMLInputElement, v: string) => {
      zoom.value = v;
      zoom.dispatchEvent(new Event('input'));
    };
    const blob = () => new Blob(['x'], { type: 'image/png' });

    it('holds a click made while an encode is still running, and downloads the newest picture', async () => {
      const { zoom, link, canvas } = await ready();
      const pending = holdEncodes(canvas);
      const relaunch = vi.spyOn(link, 'click');
      vi.useFakeTimers();
      try {
        zoomTo(zoom, '2');
        await vi.advanceTimersByTimeAsync(400);
        expect(pending).toHaveLength(1);
        const click = new MouseEvent('click', { cancelable: true });
        link.dispatchEvent(click);
        expect(click.defaultPrevented).toBe(true);
        expect(link.getAttribute('href')).toBe('blob:fair-1');
        pending[0]!(blob());
        await vi.advanceTimersByTimeAsync(0);
        expect(link.getAttribute('href')).toBe('blob:fair-2');
        pending[1]?.(blob());
        await vi.advanceTimersByTimeAsync(0);
        expect(relaunch).toHaveBeenCalledTimes(1);
        expect(link.getAttribute('href')).toBe('blob:fair-2');
      } finally {
        vi.useRealTimers();
      }
    });

    it('never lets an older encode that finishes last replace a newer picture', async () => {
      const { zoom, link, canvas, create } = await ready();
      const pending = holdEncodes(canvas);
      vi.useFakeTimers();
      try {
        zoomTo(zoom, '2');
        await vi.advanceTimersByTimeAsync(400);
        zoomTo(zoom, '3');
        await vi.advanceTimersByTimeAsync(400);
        expect(pending).toHaveLength(2);
        pending[1]!(blob());
        await vi.advanceTimersByTimeAsync(0);
        expect(link.getAttribute('href')).toBe('blob:fair-2');
        pending[0]!(blob());
        await vi.advanceTimersByTimeAsync(0);
        expect(link.getAttribute('href')).toBe('blob:fair-2');
        expect(create).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('says so and shows the ring again when the picture cannot be made after a move', async () => {
      const { page, zoom, canvas, photo } = await ready();
      (canvas as unknown as { toBlob: (cb: (b: Blob | null) => void) => void }).toBlob = (cb) => cb(null);
      vi.useFakeTimers();
      try {
        zoomTo(zoom, '2');
        await vi.advanceTimersByTimeAsync(400);
      } finally {
        vi.useRealTimers();
      }
      expect(page.el.querySelector('.strv-badges__frame .strv-badges__note')!.textContent).toBe('Couldn’t make the picture. Try again.');
      expect(page.el.querySelector('.strv-badges__frame .strv-badges__preview img')!.getAttribute('src')).toBe('/badges/frame.png');
      expect(photo.close).toHaveBeenCalledTimes(1);
    });

    it('makes no picture after the page goes, even with a move waiting', async () => {
      const { page, zoom, create } = await ready();
      vi.useFakeTimers();
      try {
        zoomTo(zoom, '2');
        page.destroy?.();
        await vi.advanceTimersByTimeAsync(400);
      } finally {
        vi.useRealTimers();
      }
      expect(create).toHaveBeenCalledTimes(1);
    });

    it('leaves modified arrows to the browser and ignores a right click drag', async () => {
      const { canvas, draws } = await ready();
      const n = draws.length;
      const back = new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, cancelable: true });
      canvas.dispatchEvent(back);
      expect(back.defaultPrevented).toBe(false);
      const ptr = (type: string, x: number, init: MouseEventInit) =>
        canvas.dispatchEvent(Object.assign(new MouseEvent(type, { clientX: x, ...init }), { pointerId: 1, pointerType: 'mouse' }));
      ptr('pointerdown', 500, { button: 2 });
      ptr('pointermove', 400, { buttons: 2 });
      expect(draws).toHaveLength(n);
    });

    it('stops dragging when the mouse button is already up', async () => {
      const { canvas, draws } = await ready();
      const ptr = (type: string, x: number, init: MouseEventInit) =>
        canvas.dispatchEvent(Object.assign(new MouseEvent(type, { clientX: x, ...init }), { pointerId: 1, pointerType: 'mouse' }));
      ptr('pointerdown', 500, { button: 0, buttons: 1 });
      ptr('pointermove', 450, { buttons: 1 });
      const n = draws.length;
      ptr('pointermove', 400, { buttons: 0 });
      ptr('pointermove', 300, { buttons: 1 });
      expect(draws).toHaveLength(n);
    });

    it('encodes the download by itself once the moves stop', async () => {
      const { zoom, link } = await ready();
      vi.useFakeTimers();
      try {
        zoom.value = '1.5';
        zoom.dispatchEvent(new Event('input'));
        await vi.advanceTimersByTimeAsync(400);
        expect(link.getAttribute('href')).toBe('blob:fair-2');
      } finally {
        vi.useRealTimers();
      }
    });
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
