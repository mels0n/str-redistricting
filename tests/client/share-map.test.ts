// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, sharePath } from '../../src/client/shared';
import { createShareButton, shareContent } from '../../src/client/features/share-map';

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
});
