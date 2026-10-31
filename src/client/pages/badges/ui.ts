import { h, announce, config, tokens, PAGE_META, type Chamber, routeHref, iconArrowLeft, NATIONAL, PRIVACY, PLEDGES, type Page } from '../../shared';
import { loadIndex, byName, chamberView, isGeneratedIn, nameOfState, seatsIn, type StateIndex } from '../../entities/state';
import { badgeAssets, badgeSnippet, type BadgeChoice } from '../../features/badge-snippet';

/** A badge card and the way to make it re-read its choice after the choice has changed. */
export interface BadgeCard {
  el: HTMLElement;
  refresh: () => void;
  /** Rename the card, for a card that follows a select. */
  setTitle: (title: string) => void;
}

const COPIED_MS = 2000;
let cardCount = 0;

/**
 * One badge: its preview (the same address an embed loads), a light and dark switch, the snippet to paste and the files to
 * download. `choice` gives the badge each time the card draws, so a card whose badge can change (the state badge) is
 * redrawn by calling `refresh`. The card keeps only the light or dark choice; the rest comes from `choice`. When `choice`
 * gives nothing the card shows `emptyText` (given as text, or as a function so it can change) in place of the picture and
 * has nothing to copy or download.
 */
export function badgeCard(choice: () => BadgeChoice | null, title: string, emptyText: string | (() => string) = ''): BadgeCard {
  const uid = `strv-badges-card-${cardCount++}`;
  let theme: BadgeChoice['theme'] = 'light';
  let timer: ReturnType<typeof setTimeout> | undefined;

  const img = h('img', { class: 'strv-badges__img', alt: '' });
  const preview = h('div', { class: 'strv-badges__preview' }, img);
  const box = h('textarea', { class: 'strv-badges__code', id: `${uid}-code`, readonly: true, rows: 5, spellcheck: false, 'aria-label': `HTML for the ${title} badge` });
  const heading = h('h2', { class: 'strv-badges__h', id: `${uid}-h` }, title);
  const group = h('div', { class: 'strv-badges__switch', role: 'group', 'aria-label': `${title} colors` });
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

  const empty = h('p', { class: 'strv-badges__empty' });

  function refresh(): void {
    const picked = choice();
    resetCopy();
    switchButtons.forEach((b, i) => b.setAttribute('aria-pressed', String((i === 0) === (theme === 'light'))));
    if (!picked) {
      empty.textContent = typeof emptyText === 'function' ? emptyText() : emptyText;
      preview.replaceChildren(empty);
      preview.classList.remove('strv-badges__preview--dark');
      box.value = box.defaultValue = '';
      downloads.replaceChildren();
      copy.disabled = true;
      return;
    }
    copy.disabled = false;
    if (img.parentNode !== preview) preview.replaceChildren(img);
    const c: BadgeChoice = { ...picked, theme };
    const a = badgeAssets(c, config.siteHost);
    img.setAttribute('src', a.previewImage);
    if (a.previewImage2x) img.setAttribute('srcset', `${a.previewImage2x} 2x`);
    else img.removeAttribute('srcset');
    img.setAttribute('alt', a.alt);
    img.setAttribute('width', String(a.width));
    img.setAttribute('height', String(a.height));
    preview.classList.toggle('strv-badges__preview--dark', theme === 'dark');
    // The default value too, so the prerendered page carries the snippet (serialized HTML holds a textarea's default, not its value).
    box.value = box.defaultValue = badgeSnippet(c, config.siteHost);
    downloads.replaceChildren(...a.downloads.map((d) => h('li', null, h('a', { href: d.href, download: '', 'aria-label': `${title}, ${d.label}` }, d.label))));
  }
  refresh();
  group.append(...switchButtons);

  const el = h(
    'article',
    { class: 'strv-badges__card', 'aria-labelledby': `${uid}-h` },
    heading,
    preview,
    group,
    h('label', { class: 'strv-badges__label', for: `${uid}-code` }, 'Paste this into your page'),
    box,
    copy,
    downloads,
  );
  function setTitle(t: string): void {
    heading.textContent = t;
    box.setAttribute('aria-label', `HTML for the ${t} badge`);
    group.setAttribute('aria-label', `${t} colors`);
  }
  return { el, refresh, setTitle };
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
const NO_MAP = 'No map published yet for this chamber.';
const LOAD_FAILED = 'The list of states didn’t load. Reload the page to try again.';

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
  const message = (ch: Chamber): string => {
    if (!abbr) return STATE_PROMPT;
    const s = index?.states.find((x) => x.abbr === abbr);
    // An index that lists chambers and gives this one no districts: the state does not have it (Nebraska's legislature has one).
    if (s && s.chambers !== undefined && ch !== 'federal-house' && seatsIn(s, ch) === 0) {
      const other: Chamber = ch === 'state-house' ? 'state-senate' : 'state-house';
      const name = (c: Chamber): string => CHAMBER_CHOICES.find((x) => x.value === c)!.label;
      return seatsIn(s, other) > 0 ? `${s.name} has one legislative chamber, its ${name(other)}. There is no State ${name(ch)} to draw.` : `${s.name} has no State ${name(ch)} to draw.`;
    }
    return NO_MAP;
  };
  const chamberLabel = (): string => `State ${CHAMBER_CHOICES.find((c) => c.value === chamber)!.label}`;
  const usHouse = badgeCard(() => choiceFor('federal-house'), 'US House', () => message('federal-house'));
  const stateCard = badgeCard(() => choiceFor(chamber), chamberLabel(), () => message(chamber));
  const note = h('p', { class: 'strv-badges__note', role: 'status' });

  function fillStates(): void {
    const offered = index ? byName(index).filter((s) => isGeneratedIn(s, 'federal-house') || isGeneratedIn(s, chamber)) : [];
    if (!offered.some((s) => s.abbr === abbr)) abbr = '';
    stateSelect.replaceChildren(h('option', { value: '' }, 'Choose your state'), ...offered.map((s) => h('option', { value: s.abbr }, s.name)));
    stateSelect.value = abbr;
  }
  function draw(): void {
    stateCard.setTitle(chamberLabel());
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
    () => {
      if (!gone) note.textContent = LOAD_FAILED;
    },
  );

  const el = h(
    'section',
    { class: 'strv-badges__state', 'aria-labelledby': 'strv-badges-state-h' },
    h('h2', { class: 'strv-badges__h', id: 'strv-badges-state-h' }, 'A badge for your state'),
    h('p', null, 'Pick your state, then the chamber. Each badge shows our map for it and links to that map.'),
    h(
      'div',
      { class: 'strv-badges__pickers' },
      h('label', { class: 'strv-badges__label', for: 'strv-badges-state' }, 'Your state'),
      stateSelect,
      h('label', { class: 'strv-badges__label', for: 'strv-badges-chamber' }, 'Chamber'),
      chamberSelect,
    ),
    note,
    h('div', { class: 'strv-badges__grid' }, usHouse.el, stateCard.el),
  );
  return { el, destroy: () => void (gone = true) };
}

const FRAME_SIZE = 1080;
const FRAME_MAX_BYTES = 20 * 1024 * 1024;
const FRAME_RING = '/badges/frame.png';
const FRAME_PRINT = '/badges/frame-print.png';
const NOT_PICTURE = 'That file isn’t a picture. Choose a JPG or PNG.';
const MAKE_FAILED = 'Couldn’t make the picture. Try again.';
const TOO_LARGE = 'That picture is too large. Choose one under 20 MB.';

/** The browser pieces the photo tool needs, so a test can stand in for them. */
export interface FrameDeps {
  /** Decode a chosen file into something a canvas can draw. */
  decode: (file: File) => Promise<ImageBitmap>;
  /** The ring picture, from this site. */
  loadRing: () => Promise<CanvasImageSource>;
  makeCanvas: () => HTMLCanvasElement;
}

const browserDeps: FrameDeps = {
  decode: (file) => createImageBitmap(file),
  loadRing: () =>
    new Promise((resolve, reject) => {
      const ring = new Image();
      ring.onload = () => resolve(ring);
      ring.onerror = () => reject(new Error('ring did not load'));
      ring.src = FRAME_RING;
    }),
  makeCanvas: () => document.createElement('canvas'),
};

/**
 * The profile photo frame: the ring to download, and a tool that puts a chosen photo under the ring. The photo is decoded
 * and drawn on a canvas in this page and is never sent anywhere.
 */
function frameCard(deps: FrameDeps): { el: HTMLElement; destroy: () => void } {
  let url = '';
  let latest = 0;
  let gone = false;
  const revoke = (): void => {
    if (url) URL.revokeObjectURL(url);
    url = '';
  };

  const input = h('input', { type: 'file', accept: 'image/*', id: 'strv-badges-photo', class: 'strv-badges__file' });
  const message = h('p', { class: 'strv-badges__note', role: 'status' });
  const result = h('div', { class: 'strv-badges__preview' });

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    const mine = ++latest;
    revoke();
    result.replaceChildren();
    message.textContent = '';
    if (!file.type.startsWith('image/')) {
      message.textContent = NOT_PICTURE;
      return;
    }
    if (file.size > FRAME_MAX_BYTES) {
      message.textContent = TOO_LARGE;
      return;
    }
    void build(file, mine);
  });

  const current = (mine: number): boolean => !gone && mine === latest;
  async function build(file: File, mine: number): Promise<void> {
    let photo: ImageBitmap;
    try {
      photo = await deps.decode(file);
    } catch {
      if (current(mine)) message.textContent = NOT_PICTURE;
      return;
    }
    try {
      const ring = await deps.loadRing();
      if (!current(mine)) return;
      const canvas = deps.makeCanvas();
      canvas.width = FRAME_SIZE;
      canvas.height = FRAME_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      const side = Math.min(photo.width, photo.height);
      // A transparent PNG would otherwise leave transparent pixels, which social sites show as black.
      ctx.fillStyle = tokens.ground;
      ctx.fillRect(0, 0, FRAME_SIZE, FRAME_SIZE);
      ctx.drawImage(photo, (photo.width - side) / 2, (photo.height - side) / 2, side, side, 0, 0, FRAME_SIZE, FRAME_SIZE);
      ctx.drawImage(ring, 0, 0, FRAME_SIZE, FRAME_SIZE);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!current(mine)) return;
      if (!blob) throw new Error('no picture');
      url = URL.createObjectURL(blob);
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', 'Your photo inside the Fair Maps ring');
      result.replaceChildren(canvas, h('a', { href: url, download: 'fair-maps-photo.png', class: 'strv-button strv-button--ink' }, 'Download my photo'));
    } catch {
      if (current(mine)) message.textContent = MAKE_FAILED;
    } finally {
      photo.close?.();
    }
  }

  const el = h(
    'article',
    { class: 'strv-badges__frame', 'aria-labelledby': 'strv-badges-frame-h' },
    h('h2', { class: 'strv-badges__h', id: 'strv-badges-frame-h' }, 'Profile photo frame'),
    h('p', null, 'A round Fair Maps ring for your profile picture on social media. Download the ring to add yourself, or put your photo inside it here.'),
    h(
      'ul',
      { class: 'strv-badges__downloads' },
      h('li', null, h('a', { href: FRAME_RING, download: '' }, 'Download the ring (PNG)')),
      h('li', null, h('a', { href: FRAME_PRINT, download: '' }, 'Download the print ring (PNG)')),
    ),
    h('label', { class: 'strv-badges__label', for: 'strv-badges-photo' }, 'Use my photo'),
    input,
    h('p', null, 'Your photo stays on your device. It is never uploaded.'),
    message,
    result,
  );
  return {
    el,
    destroy: () => {
      gone = true;
      revoke();
    },
  };
}

/** Badges a candidate can put on a campaign site, each with the code to paste and the files to download. */
export function createBadgesPage(load: () => Promise<StateIndex> = loadIndex, frameDeps: FrameDeps = browserDeps): Page {
  const picker = statePicker(load);
  const frame = frameCard(frameDeps);
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
        h('a', { href: routeHref(PRIVACY) }, 'never who visited'),
        ', and list the site on ',
        h('a', { href: routeHref(PLEDGES) }, 'Sites that show the badge'),
        '.',
      ),
    ),
    h('div', { class: 'strv-badges__grid' }, ...FIXED.map((f) => badgeCard(() => ({ id: f.id, theme: 'light' }), f.title).el)),
    picker.el,
    h('div', { class: 'strv-badges__grid' }, frame.el),
  );
  document.title = PAGE_META.badges.title;
  return {
    el,
    focusTarget: () => h1,
    destroy: () => {
      picker.destroy();
      frame.destroy();
    },
  };
}
