// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createAskComposer, HOUSE_FINDER_URL, HOUSE_HINT, NO_ONLINE_COPY } from '../../src/client/features/ask-rep';

const letter = { subject: 'S', body: 'B' };
const base = { name: 'Ann Wagner', letter, contactUrl: null, email: null, phone: null, website: null };
const texts = (root: Element, sel = 'a, button') => [...root.querySelectorAll(sel)].map((e) => e.textContent);

describe('ask composer: where to send it', () => {
  it('lists a House member with only a website and phone: website link, the hint, the finder, no Copy email', () => {
    const el = createAskComposer({ ...base, office: 'us-house', website: 'https://wagner.house.gov', phone: '+1 202 225 1621' });
    expect(el.querySelector('.strv-ask__where-h')!.textContent).toBe('Where to send it');
    const site = [...el.querySelectorAll('a')].find((a) => a.textContent === 'Their website')!;
    expect(site.getAttribute('href')).toBe('https://wagner.house.gov');
    expect(site.getAttribute('rel')).toBe('noopener');
    expect(el.textContent).toContain(HOUSE_HINT);
    expect(el.textContent).toContain(NO_ONLINE_COPY);
    expect([...el.querySelectorAll('a')].find((a) => a.textContent === 'House contact form finder')!.getAttribute('href')).toBe(HOUSE_FINDER_URL);
    expect(texts(el)).not.toContain('Copy email');
    expect(el.querySelector('a[href="tel:+12022251621"]')).not.toBeNull();
  });

  it('shows the address as text with Copy email and the mailto link, in order: email, form, website, phone', () => {
    const el = createAskComposer({ ...base, office: 'us-senate', email: 'a@b.co', contactUrl: 'https://s.gov/c', website: 'https://s.gov', phone: '555-0100' });
    expect(el.querySelector('.strv-ask__addr')!.textContent).toBe('a@b.co');
    expect(texts(el.querySelector('.strv-ask__dests')!)).toEqual(['Copy email', 'Email', 'Open their contact form', 'Their website', '555-0100']);
    expect(el.textContent).not.toContain(NO_ONLINE_COPY);
    expect(el.textContent).not.toContain(HOUSE_HINT);
  });

  it('copies the address', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const el = createAskComposer({ ...base, email: 'a@b.co' });
    ([...el.querySelectorAll('button')].find((b) => b.textContent === 'Copy email') as HTMLButtonElement).click();
    expect(writeText).toHaveBeenCalledWith('a@b.co');
    vi.unstubAllGlobals();
  });

  it('refuses a non-web website and has no em dash', () => {
    const el = createAskComposer({ ...base, website: 'javascript:alert(1)' });
    expect(texts(el)).not.toContain('Their website');
    expect(el.textContent).not.toContain('—');
  });
});
