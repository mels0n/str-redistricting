import { h, announce, config, PAGE_META, type Chamber, routeHref, iconArrowLeft, NATIONAL, PRIVACY, PLEDGES, type Page } from '../../shared';
import { loadIndex, byName, chamberView, isGeneratedIn, nameOfState, type StateIndex } from '../../entities/state';
import { badgeAssets, badgeSnippet, type BadgeChoice } from '../../features/badge-snippet';

/** A badge card and the way to make it re-read its choice after the choice has changed. */
export interface BadgeCard {
  el: HTMLElement;
  refresh: () => void;
}

const COPIED_MS = 2000;
let cardCount = 0;

/**
 * One badge: its preview (the same address an embed loads), a light and dark switch, the snippet to paste and the files to
 * download. `choice` gives the badge each time the card draws, so a card whose badge can change (the state badge) is
 * redrawn by calling `refresh`. The card keeps only the light or dark choice; the rest comes from `choice`. When `choice`
 * gives nothing the card shows `emptyText` in place of the picture and has nothing to copy or download.
 */
export function badgeCard(choice: () => BadgeChoice | null, title: string, emptyText = ''): BadgeCard {
  const uid = `strv-badges-card-${cardCount++}`;
  let theme: BadgeChoice['theme'] = 'light';
  let timer: ReturnType<typeof setTimeout> | undefined;

  const img = h('img', { class: 'strv-badges__img', alt: '' });
  const preview = h('div', { class: 'strv-badges__preview' }, img);
  const box = h('textarea', { class: 'strv-badges__code', id: `${uid}-code`, readonly: true, rows: 5, spellcheck: false, 'aria-label': `HTML for the ${title} badge` });
  const downloads = h('ul', { class: 'strv-badges__downloads' });
  const copy = h('button', { type: 'button', class: 'strv-button strv-button--ink' }, 'Copy');
  const switchButtons = (['light', 'dark'] as const).map((t) =>
    h(
      'button',
      {
        type: 'button',
        class: 'strv-badges__option',
        'aria-pressed': 'false',
        onclick: () => {
          theme = t;
          refresh();
        },
      },
      t === 'light' ? 'Light' : 'Dark',
    ),
  );

  const resetCopy = (): void => {
    clearTimeout(timer);
    copy.textContent = 'Copy';
  };
  copy.addEventListener('click', () => {
    const fallback = (): void => {
      box.focus();
      box.select();
      copy.textContent = 'Select and copy';
    };
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      fallback();
      return;
    }
    navigator.clipboard.writeText(box.value).then(() => {
      copy.textContent = 'Copied';
      announce('Copied');
      clearTimeout(timer);
      timer = setTimeout(resetCopy, COPIED_MS);
    }, fallback);
  });

  const empty = h('p', { class: 'strv-badges__empty' }, emptyText);

  function refresh(): void {
    const picked = choice();
    resetCopy();
    switchButtons.forEach((b, i) => b.setAttribute('aria-pressed', String((i === 0) === (theme === 'light'))));
    if (!picked) {
      preview.replaceChildren(empty);
      preview.classList.remove('strv-badges__preview--dark');
      box.value = '';
      downloads.replaceChildren();
      copy.disabled = true;
      return;
    }
    copy.disabled = false;
    if (img.parentNode !== preview) preview.replaceChildren(img);
    const c: BadgeChoice = { ...picked, theme };
    const a = badgeAssets(c, config.siteHost);
    img.setAttribute('src', a.image);
    if (a.image2x) img.setAttribute('srcset', `${a.image2x} 2x`);
    else img.removeAttribute('srcset');
    img.setAttribute('alt', a.alt);
    img.setAttribute('width', String(a.width));
    img.setAttribute('height', String(a.height));
    preview.classList.toggle('strv-badges__preview--dark', theme === 'dark');
    box.value = badgeSnippet(c, config.siteHost);
    downloads.replaceChildren(...a.downloads.map((d) => h('li', null, h('a', { href: d.href, download: '' }, d.label))));
  }
  refresh();

  const el = h(
    'article',
    { class: 'strv-badges__card', 'aria-labelledby': `${uid}-h` },
    h('h2', { class: 'strv-badges__h', id: `${uid}-h` }, title),
    preview,
    h('div', { class: 'strv-badges__switch', role: 'group', 'aria-label': `${title} colors` }, ...switchButtons),
    h('label', { class: 'strv-badges__label', for: `${uid}-code` }, 'Paste this into your page'),
    box,
    h('div', { class: 'strv-badges__actions' }, copy),
    downloads,
  );
  return { el, refresh };
}

const FIXED: { id: 'crest' | 'seal' | 'pledge' | 'button'; title: string }[] = [
  { id: 'crest', title: 'Crest' },
  { id: 'seal', title: 'Seal' },
  { id: 'pledge', title: 'Pledge' },
  { id: 'button', title: 'Button' },
];

const CHAMBER_CHOICES: { value: Chamber; label: string }[] = [
  { value: 'state-house', label: 'House' },
  { value: 'state-senate', label: 'Senate' },
];
const STATE_PROMPT = 'Choose your state to see its badge';

/**
 * The state badge cards: a state select and a chamber select drive the US House card and the card for the chosen state
 * chamber. The page draws without the index; the state list fills in when `load` resolves.
 */
function statePicker(load: () => Promise<StateIndex>): { el: HTMLElement; destroy: () => void } {
  let index: StateIndex | null = null;
  let abbr = '';
  let chamber: Chamber = 'state-house';
  let gone = false;

  const stateSelect = h('select', { class: 'strv-badges__select', id: 'strv-badges-state', 'aria-label': 'Your state' }, h('option', { value: '' }, 'Choose your state'));
  const chamberSelect = h(
    'select',
    { class: 'strv-badges__select', id: 'strv-badges-chamber', 'aria-label': 'Chamber' },
    ...CHAMBER_CHOICES.map((c) => h('option', { value: c.value }, c.label)),
  );

  const choiceFor = (ch: Chamber): BadgeChoice | null => {
    const s = index?.states.find((x) => x.abbr === abbr);
    if (!s || !isGeneratedIn(s, ch)) return null;
    return { id: 'state', theme: 'light', abbr, stateName: nameOfState(abbr) ?? s.name, chamber: ch, seats: chamberView(s, ch).seats };
  };
  const usHouse = badgeCard(() => choiceFor('federal-house'), 'US House', STATE_PROMPT);
  const stateCard = badgeCard(() => choiceFor(chamber), 'State chamber', STATE_PROMPT);

  function fillStates(): void {
    const offered = index ? byName(index).filter((s) => isGeneratedIn(s, chamber)) : [];
    if (!offered.some((s) => s.abbr === abbr)) abbr = '';
    stateSelect.replaceChildren(h('option', { value: '' }, 'Choose your state'), ...offered.map((s) => h('option', { value: s.abbr }, s.name)));
    stateSelect.value = abbr;
  }
  function draw(): void {
    usHouse.refresh();
    stateCard.refresh();
  }

  stateSelect.addEventListener('change', () => {
    abbr = stateSelect.value;
    draw();
  });
  chamberSelect.addEventListener('change', () => {
    chamber = chamberSelect.value as Chamber;
    fillStates();
    draw();
  });
  load().then(
    (i) => {
      if (gone) return;
      index = i;
      fillStates();
      draw();
    },
    () => undefined,
  );

  const el = h(
    'section',
    { class: 'strv-badges__state', 'aria-label': 'Your state badge' },
    h(
      'div',
      { class: 'strv-badges__pickers' },
      h('label', { class: 'strv-badges__label', for: 'strv-badges-state' }, 'Your state'),
      stateSelect,
      h('label', { class: 'strv-badges__label', for: 'strv-badges-chamber' }, 'Chamber'),
      chamberSelect,
    ),
    h('div', { class: 'strv-badges__grid' }, usHouse.el, stateCard.el),
  );
  return { el, destroy: () => void (gone = true) };
}

/** Badges a candidate can put on a campaign site, each with the code to paste and the files to download. */
export function createBadgesPage(load: () => Promise<StateIndex> = loadIndex): Page {
  const picker = statePicker(load);
  const h1 = h('h1', { class: 'strv-how__h1', tabindex: -1 }, 'Badges for candidates');
  const el = h(
    'main',
    { class: 'strv-how strv-badges', id: 'strv-main' },
    h(
      'header',
      { class: 'strv-how__head' },
      h('a', { href: routeHref(NATIONAL), class: 'strv-back' }, iconArrowLeft(), 'All states'),
      h1,
      h(
        'p',
        { class: 'strv-how__lede' },
        'Put a Fair Maps badge on your campaign site. Each one is a picture with a link back here, with no script. When a page shows a badge, we note that page’s address, ',
        h('a', { href: `${routeHref(PRIVACY)}#strv-privacy-badge` }, 'never who visited'),
        ', and list the site on ',
        h('a', { href: routeHref(PLEDGES) }, 'Sites that show the badge'),
        '.',
      ),
    ),
    h('div', { class: 'strv-badges__grid' }, ...FIXED.map((f) => badgeCard(() => ({ id: f.id, theme: 'light' }), f.title).el)),
    picker.el,
  );
  document.title = PAGE_META.badges.title;
  return { el, focusTarget: () => h1, destroy: picker.destroy };
}
