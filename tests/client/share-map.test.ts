// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, sharePath } from '../../src/client/shared';
import { createShareButton, shareContent } from '../../src/client/features/share-map';
import { sharePageHtml } from '../../build/share-pages';

const CO = { abbr: 'CO', name: 'Colorado', seats: 8, chamber: 'federal-house' } as const;
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('sharePath', () => {
  it('keeps the federal House at the original state path and gives each state chamber its own', () => {
    expect(sharePath('CO', 'federal-house')).toBe('/CO/');
    expect(sharePath('CO', 'state-senate')).toBe('/CO/senate/');
    expect(sharePath('CO', 'state-house')).toBe('/CO/house/');
  });
});

describe('shareContent', () => {
  it('links the state share page and carries the count and the tagline', () => {
    const c = shareContent({ abbr: 'CO', name: 'Colorado', seats: 8, chamber: 'federal-house' });
    expect(c.url).toBe(`https://${config.siteHost}/CO/`);
    expect(c.title).toBe('Colorado: districts drawn by Fair Maps');
    expect(c.text).toBe(`Colorado's 8 congressional districts. ${config.tagline}`);
  });
  it('gives the share sheet the same title the share page shows link previews', () => {
    const page = sharePageHtml({ abbr: 'CO', name: 'Colorado', seats: 8 }, `https://${config.siteHost}`);
    expect(page).toContain(`<title>${shareContent(CO).title}</title>`);
  });
  it('says district for a single seat and names a state chamber', () => {
    expect(shareContent({ abbr: 'VT', name: 'Vermont', seats: 1, chamber: 'federal-house' }).text).toContain("Vermont's 1 congressional district.");
    expect(shareContent({ abbr: 'CO', name: 'Colorado', seats: 35, chamber: 'state-senate' }).text).toContain('35 state senate districts');
  });
});

describe('createShareButton', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('is hidden until a map is set', () => {
    const b = createShareButton();
    expect(b.el.hidden).toBe(true);
    b.set({ abbr: 'CO', name: 'Colorado', seats: 8, chamber: 'federal-house' });
    expect(b.el.hidden).toBe(false);
    b.set(null);
    expect(b.el.hidden).toBe(true);
  });

  it('copies the link where there is no share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const b = createShareButton();
    b.set({ abbr: 'CO', name: 'Colorado', seats: 8, chamber: 'federal-house' });
    b.el.querySelector('button')!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(`https://${config.siteHost}/CO/`);
    expect(b.el.textContent).toContain('Link copied');
  });

  it('shows the link selected when copying is refused', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    const b = createShareButton();
    document.body.append(b.el);
    b.set({ abbr: 'CO', name: 'Colorado', seats: 8, chamber: 'federal-house' });
    b.el.querySelector('button')!.click();
    await new Promise((r) => setTimeout(r, 0));
    const input = b.el.querySelector('input')!;
    expect(input.hidden).toBe(false);
    expect(input.value).toBe(`https://${config.siteHost}/CO/`);
    b.el.remove();
  });

  it('opens the share sheet on a touch screen that has one', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share, clipboard: { writeText: vi.fn() } });
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(pointer: coarse)' }));
    const b = createShareButton();
    b.set({ abbr: 'CO', name: 'Colorado', seats: 8, chamber: 'federal-house' });
    b.el.querySelector('button')!.click();
    expect(share).toHaveBeenCalledWith(shareContent({ abbr: 'CO', name: 'Colorado', seats: 8, chamber: 'federal-house' }));
  });

  it('copies instead of opening the share sheet on a mouse or trackpad, even where the sheet exists', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share, clipboard: { writeText } });
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const b = createShareButton();
    b.set(CO);
    b.el.querySelector('button')!.click();
    await flush();
    expect(share).not.toHaveBeenCalled();
    expect(writeText).toHaveBeenCalledWith(`https://${config.siteHost}/CO/`);
  });

  it('does nothing more when the share sheet is closed', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(new DOMException('closed', 'AbortError')), clipboard: { writeText } });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const b = createShareButton();
    b.set(CO);
    b.el.querySelector('button')!.click();
    await flush();
    expect(writeText).not.toHaveBeenCalled();
    expect(b.el.querySelector('input')!.hidden).toBe(true);
  });

  it('copies the link when the share sheet fails', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { share: vi.fn().mockRejectedValue(new DOMException('no', 'NotAllowedError')), clipboard: { writeText } });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const b = createShareButton();
    b.set(CO);
    b.el.querySelector('button')!.click();
    await flush();
    expect(writeText).toHaveBeenCalledWith(`https://${config.siteHost}/CO/`);
  });

  it('ignores a second tap while the share sheet is open', async () => {
    let close: () => void = () => undefined;
    const share = vi.fn(() => new Promise<void>((r) => (close = r)));
    vi.stubGlobal('navigator', { share, clipboard: { writeText: vi.fn() } });
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const b = createShareButton();
    b.set(CO);
    const button = b.el.querySelector('button')!;
    button.click();
    button.click();
    expect(share).toHaveBeenCalledTimes(1);
    close();
    await flush();
    button.click();
    expect(share).toHaveBeenCalledTimes(2);
  });

  it('reads Share again a moment after Link copied', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
      const b = createShareButton();
      b.set(CO);
      b.el.querySelector('button')!.click();
      await vi.advanceTimersByTimeAsync(0);
      expect(b.el.querySelector('button')!.textContent).toBe('Link copied');
      await vi.advanceTimersByTimeAsync(2500);
      expect(b.el.querySelector('button')!.textContent).toBe('Share');
    } finally {
      vi.useRealTimers();
    }
  });

  it('selects the shown link, and hides it again once a copy works or the map changes', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const b = createShareButton();
    document.body.append(b.el);
    b.set(CO);
    const button = b.el.querySelector('button')!;
    const input = b.el.querySelector('input')!;
    button.click();
    await flush();
    expect(input.hidden).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(input.selectionEnd! - input.selectionStart!).toBe(input.value.length);
    button.click();
    await flush();
    expect(input.hidden).toBe(true);
    writeText.mockRejectedValueOnce(new Error('denied'));
    button.click();
    await flush();
    expect(input.hidden).toBe(false);
    b.set({ ...CO, abbr: 'RI', name: 'Rhode Island', seats: 2 });
    expect(input.hidden).toBe(true);
    b.el.remove();
  });
});
