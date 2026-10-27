// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, PAGE_META } from '../../src/client/shared';
import type { Pledge } from '../../src/client/entities/pledges';

let fixture: Pledge[] = [];
vi.mock('../../src/client/entities/pledges', async (orig) => ({
  ...(await orig<typeof import('../../src/client/entities/pledges')>()),
  loadPledges: async () => fixture,
}));

import { createPledgesPage } from '../../src/client/pages/pledges';

const pledge = (id: string, over: Partial<Pledge> = {}): Pledge => ({
  id, name: `Name ${id}`, role: 'incumbent', personId: id, office: 'us-house', state: 'CO', districtCode: '03',
  statementUrl: `https://example.org/${id}`, campaignUrl: null, pledgedOn: '2026-10-01', cycle: null, ...over,
});
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('pledges page', () => {
  afterEach(() => {
    config.showCandidates = false;
    document.body.replaceChildren();
  });

  it('has the heading, lede, pledge sentence, issue form link and badge snippet', async () => {
    const page = createPledgesPage();
    await flush();
    expect(page.el.querySelector('h1')!.textContent).toBe('Who supports the Fair Maps rule');
    expect(page.el.querySelector('.strv-how__lede')!.textContent).toBe(
      'Officeholders and candidates listed here have said publicly that they support drawing districts with the Fair Maps rule. Each links to their own statement. Listed in the order they pledged. Party is not shown.',
    );
    expect(page.el.querySelector('blockquote')!.textContent).toContain('split the state along the shortest line that divides its people evenly');
    expect([...page.el.querySelectorAll('h2')].map((e) => e.textContent)).toEqual(['How to be listed', 'Add the badge to your site']);
    expect(page.el.querySelector('a[href$="/issues/new?template=pledge.yml"]')).not.toBeNull();
    expect(page.el.querySelector('pre')!.textContent).toBe('<a href="https://fairmaps.melson.us/pledges"><img src="https://fairmaps.melson.us/badge.svg" alt="I back Fair Maps" width="200" height="40"></a>');
    expect(document.title).toBe(PAGE_META.pledges.title);
    expect(page.el.textContent).not.toContain('—');
  });

  it('says so when no one has pledged', async () => {
    fixture = [];
    const page = createPledgesPage();
    await flush();
    expect(page.el.querySelector('.strv-pledges__empty')!.textContent).toBe('No one has pledged yet.');
  });

  it('lists incumbents oldest first and hides candidates while showCandidates is false', async () => {
    fixture = [pledge('b', { pledgedOn: '2026-10-05' }), pledge('c', { role: 'candidate', personId: null, pledgedOn: '2026-10-02' }), pledge('a', { pledgedOn: '2026-10-01' })];
    const page = createPledgesPage();
    await flush();
    expect([...page.el.querySelectorAll('.strv-pledges__row strong')].map((e) => e.textContent)).toEqual(['Name a', 'Name b']);
    expect(page.el.querySelector('.strv-pledges__row a')!.getAttribute('href')).toBe('https://example.org/a');
    config.showCandidates = true;
    const again = createPledgesPage();
    await flush();
    expect([...again.el.querySelectorAll('.strv-pledges__row strong')].map((e) => e.textContent)).toEqual(['Name a', 'Name c', 'Name b']);
  });

  it('takes pledges handed in for prerendering and shows no party', () => {
    const page = createPledgesPage([pledge('z')]);
    expect(page.el.querySelectorAll('.strv-pledges__row')).toHaveLength(1);
    expect(page.el.textContent!.toLowerCase()).not.toMatch(/republican|democrat/);
  });
});
