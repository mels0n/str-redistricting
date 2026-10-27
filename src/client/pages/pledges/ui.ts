import { h, clear, config, PAGE_META, routeHref, iconArrowLeft, NATIONAL, type Office, type Page } from '../../shared';
import { loadPledges, inPledgeOrder, type Pledge } from '../../entities/pledges';

/** The sentence a person pledges. */
export const PLEDGE_SENTENCE =
  "I support drawing [state]'s districts with the Fair Maps rule: split the state along the shortest line that divides its people evenly, repeat until each piece is one district, and publish the code so anyone can check the result.";

export const BADGE_SNIPPET = '<a href="https://fairmaps.melson.us/pledges"><img src="https://fairmaps.melson.us/badge.svg" alt="I back Fair Maps" width="200" height="40"></a>';

function seat(office: Office, state: string, code: string | null): string {
  if (office === 'us-senate') return `U.S. Senate, ${state}`;
  const num = code !== null && /^\d+$/.test(code) ? String(Number(code)) : (code ?? '');
  if (office === 'us-house') return `U.S. House, ${state}-${code}`;
  return `${office === 'state-senate' ? 'State Senate' : 'State House'}, ${state} district ${num}`;
}

function pledgeRow(p: Pledge): HTMLElement {
  return h(
    'li',
    { class: 'strv-pledges__row' },
    h('strong', null, p.name),
    h('span', { class: 'strv-pledges__seat' }, seat(p.office, p.state, p.districtCode)),
    h('time', { datetime: p.pledgedOn }, p.pledgedOn),
    h('a', { href: p.statementUrl, rel: 'noopener' }, 'Statement'),
  );
}

/** The pledges page. Prerendering passes the pledges in; in the browser they are fetched. */
export function createPledgesPage(preloaded?: readonly Pledge[]): Page {
  const h1 = h('h1', { class: 'strv-how__h1', tabindex: -1 }, 'Who supports the Fair Maps rule');
  const listSlot = h('div', { class: 'strv-pledges__list' });
  let dead = false;

  const fill = (all: readonly Pledge[]): void => {
    clear(listSlot);
    const shown = inPledgeOrder(all).filter((p) => p.role === 'incumbent' || config.showCandidates);
    if (shown.length === 0) {
      listSlot.append(h('p', { class: 'strv-pledges__empty' }, 'No one has pledged yet.'));
      return;
    }
    listSlot.append(h('ul', { class: 'strv-pledges__ul' }, shown.map(pledgeRow)));
  };

  if (preloaded) fill(preloaded);
  else {
    loadPledges().then(
      (all) => {
        if (!dead) fill(all);
      },
      () => {
        if (!dead) {
          clear(listSlot);
          listSlot.append(h('p', { class: 'strv-pledges__empty' }, 'We couldn’t load the list. Try again later.'));
        }
      },
    );
  }

  const el = h(
    'main',
    { class: 'strv-how strv-pledges', id: 'strv-main' },
    h(
      'header',
      { class: 'strv-how__head' },
      h('a', { href: routeHref(NATIONAL), class: 'strv-back' }, iconArrowLeft(), 'All states'),
      h1,
      h('p', { class: 'strv-how__lede' }, 'Officeholders and candidates listed here have said publicly that they support drawing districts with the Fair Maps rule. Each links to their own statement. Listed in the order they pledged. Party is not shown.'),
    ),
    h(
      'div',
      { class: 'strv-pledges__body' },
      h('blockquote', { class: 'strv-pledges__quote' }, PLEDGE_SENTENCE),
      listSlot,
      h(
        'section',
        null,
        h('h2', null, 'How to be listed'),
        h('p', null, 'Say it publicly, then ', h('a', { href: `${config.repoUrl}/issues/new?template=pledge.yml`, rel: 'noopener' }, 'tell us where'), '. A pledge is listed only if the statement it links to shows it publicly.'),
      ),
      h(
        'section',
        null,
        h('h2', null, 'Add the badge to your site'),
        h('p', null, h('img', { src: '/badge.svg', alt: 'I back Fair Maps', width: '200', height: '40' })),
        h('pre', { class: 'strv-pledges__snippet' }, h('code', null, BADGE_SNIPPET)),
      ),
    ),
  );
  document.title = PAGE_META.pledges.title;
  return {
    el,
    focusTarget: () => h1,
    destroy() {
      dead = true;
    },
  };
}
