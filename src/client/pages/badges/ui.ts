import { h, announce, config, tokens, PAGE_META, type Chamber, routeHref, iconArrowLeft, BADGES, NATIONAL, PRIVACY, PLEDGES, type Page } from '../../shared';
import { loadIndex, byName, chamberView, isGeneratedIn, nameOfState, seatsIn, type StateIndex } from '../../entities/state';
import { FRAME_PRINT, FRAME_RING, badgeAssets, badgeSnippet, type BadgeChoice } from '../../features/badge-snippet';

/** A badge card and the way to make it re-read its choice after the choice has changed. */
export interface BadgeCard {
  el: HTMLElement;
  refresh: () => void;
  /** Rename the card, for a card that follows a select. */
  setTitle: (title: string) => void;
}

const COPIED_MS = 2000;
let cardCount = 0;

/** A Copy button for a read-only box, and the way to put its label back. Without the clipboard it selects the text instead. */
function copyControl(box: HTMLTextAreaElement): { button: HTMLButtonElement; reset: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const button = h('button', { type: 'button', class: 'strv-button strv-button--ink' }, 'Copy');
  const reset = (): void => {
    clearTimeout(timer);
    button.textContent = 'Copy';
  };
  button.addEventListener('click', () => {
    const fallback = (): void => {
      box.focus();
      box.select();
      button.textContent = 'Select and copy';
    };
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      fallback();
      return;
    }
    navigator.clipboard.writeText(box.value).then(() => {
      button.textContent = 'Copied';
      announce('Copied');
      clearTimeout(timer);
      timer = setTimeout(reset, COPIED_MS);
    }, fallback);
  });
  return { button, reset };
}

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

  const img = h('img', { class: 'strv-badges__img', alt: '' });
  const preview = h('div', { class: 'strv-badges__preview' }, img);
  const box = h('textarea', { class: 'strv-badges__code', id: `${uid}-code`, readonly: true, rows: 5, spellcheck: false, 'aria-label': `HTML for the ${title} badge` });
  const heading = h('h2', { class: 'strv-badges__h', id: `${uid}-h` }, title);
  const group = h('div', { class: 'strv-badges__switch', role: 'group', 'aria-label': `${title} colors` });
  const downloads = h('ul', { class: 'strv-badges__downloads' });
  const { button: copy, reset: resetCopy } = copyControl(box);
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
/** Radius of the ring's open middle at FRAME_SIZE, inside its ink line. Must match frameSvg in src/server/features/publish/badges.ts. */
const RING_OPENING = 434;
const FRAME_MAX_BYTES = 20 * 1024 * 1024;
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

const ZOOM_MAX = 4;
/** One arrow key press moves the photo this share of the visible square. */
const NUDGE = 0.04;
/** Wait this long after the last move before encoding the download. */
const ENCODE_MS = 300;
const RING_POST = `I support fair maps. Get the ring for your profile picture at https://${config.siteHost}${routeHref(BADGES)}`;

/**
 * The profile photo frame: the ring to download, a tool that puts a chosen photo under the ring, and a line to post with
 * it so people who see the ring can find the site, since a picture can't carry a link. The photo starts center-cropped; dragging it or the arrow keys move it
 * and the slider zooms in, or out until the whole photo fits inside the ring. It is decoded and drawn on a canvas in this page and is never sent anywhere.
 */
function frameCard(deps: FrameDeps): { el: HTMLElement; destroy: () => void } {
  let url = '';
  let latest = 0;
  let gone = false;
  // The photo being adjusted, and the square of it that shows: its center and side in the photo's own pixels.
  let photo: ImageBitmap | null = null;
  let view = { x: 0, y: 0, side: 0 };
  let encodeTimer: ReturnType<typeof setTimeout> | undefined;
  const revoke = (): void => {
    if (url) URL.revokeObjectURL(url);
    url = '';
  };
  const drop = (): void => {
    clearTimeout(encodeTimer);
    photo?.close?.();
    photo = null;
  };

  const input = h('input', { type: 'file', accept: 'image/*', id: 'strv-badges-photo', class: 'strv-badges__file' });
  const message = h('p', { class: 'strv-badges__note', role: 'status' });
  const result = h('div', { class: 'strv-badges__preview' });
  // Until a photo is chosen the preview shows the ring itself, so the card never shows an empty box.
  const showRing = (): void => void result.replaceChildren(h('img', { src: FRAME_RING, alt: 'The Fair Maps ring', width: '240', height: '240', class: 'strv-badges__ring' }));
  const fail = (text: string): void => {
    message.textContent = text;
    drop();
    showRing();
  };
  showRing();

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    const mine = ++latest;
    revoke();
    drop();
    // The earlier photo's download address was just revoked, so its canvas and link go too.
    showRing();
    message.textContent = '';
    if (!file.type.startsWith('image/')) {
      fail(NOT_PICTURE);
      return;
    }
    if (file.size > FRAME_MAX_BYTES) {
      fail(TOO_LARGE);
      return;
    }
    void build(file, mine);
  });

  const current = (mine: number): boolean => !gone && mine === latest;
  async function build(file: File, mine: number): Promise<void> {
    let decoded: ImageBitmap;
    try {
      decoded = await deps.decode(file);
    } catch {
      if (current(mine)) fail(NOT_PICTURE);
      return;
    }
    if (!current(mine)) {
      decoded.close?.();
      return;
    }
    // Kept open while the photo is adjusted; closed when another is chosen, the drawing fails or the page goes.
    photo = decoded;
    try {
      const ring = await deps.loadRing();
      if (!current(mine)) return;
      const canvas = deps.makeCanvas();
      canvas.width = FRAME_SIZE;
      canvas.height = FRAME_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      const full = Math.min(decoded.width, decoded.height);
      // Zoomed all the way out, the photo's diagonal spans the ring's opening, so the whole photo, corners too, shows inside the ring.
      const whole = (Math.hypot(decoded.width, decoded.height) * FRAME_SIZE) / (2 * RING_OPENING);
      view = { x: decoded.width / 2, y: decoded.height / 2, side: full };

      const paint = (): void => {
        // A transparent PNG would otherwise leave transparent pixels, which social sites show as black.
        // The ground also fills the square around a photo zoomed out past its shorter side.
        ctx.fillStyle = tokens.ground;
        ctx.fillRect(0, 0, FRAME_SIZE, FRAME_SIZE);
        // Draw only the part of the square that lies on the photo: a source rectangle past the photo's edge is not drawn
        // the same way in every browser.
        const half = view.side / 2;
        const scale = FRAME_SIZE / view.side;
        const sx = Math.max(0, view.x - half);
        const sy = Math.max(0, view.y - half);
        const sw = Math.min(decoded.width, view.x + half) - sx;
        const sh = Math.min(decoded.height, view.y + half) - sy;
        ctx.drawImage(decoded, sx, sy, sw, sh, (sx - view.x + half) * scale, (sy - view.y + half) * scale, sw * scale, sh * scale);
        ctx.drawImage(ring, 0, 0, FRAME_SIZE, FRAME_SIZE);
      };
      const link = h('a', { download: 'fair-maps-photo.png', class: 'strv-button strv-button--ink' }, 'Download my photo');
      // Each move counts up; `shown` is the count the download link holds. Encodes can finish out of order, so a slower,
      // older one never replaces a newer picture.
      let moves = 0;
      let shown = -1;
      /** Encode the canvas as it is now into the download. True when the link holds the latest picture. */
      const encode = async (): Promise<boolean> => {
        clearTimeout(encodeTimer);
        const at = moves;
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!current(mine)) return false;
        if (!blob) throw new Error('no picture');
        if (at > shown) {
          revoke();
          url = URL.createObjectURL(blob);
          link.setAttribute('href', url);
          shown = at;
        }
        return shown === moves;
      };
      /** Encode until the link holds the latest picture. False when it failed or another photo replaced this one. */
      const settle = async (): Promise<boolean> => {
        try {
          while (current(mine) && shown !== moves) await encode();
          return current(mine);
        } catch {
          if (current(mine)) fail(MAKE_FAILED);
          return false;
        }
      };
      // Keep the shown square inside the photo along a side longer than the square, and the photo inside the square along
      // a side shorter than it; redraw, and encode the download once the moves stop.
      const move = (x: number, y: number, side: number): void => {
        view.side = Math.min(whole, Math.max(full / ZOOM_MAX, side));
        const half = view.side / 2;
        const within = (v: number, length: number): number => Math.min(Math.max(half, length - half), Math.max(Math.min(half, length - half), v));
        view.x = within(x, decoded.width);
        view.y = within(y, decoded.height);
        paint();
        moves++;
        clearTimeout(encodeTimer);
        encodeTimer = setTimeout(() => void settle(), ENCODE_MS);
      };
      link.addEventListener('click', (e) => {
        if (shown === moves) return;
        // The photo moved since the link's picture was made: make the latest one, then download that.
        e.preventDefault();
        void settle().then((ok) => {
          if (ok) link.click();
        });
      });

      // 1 fills the square with the photo's shorter side; below 1 zooms out. A step of `any` keeps 1 reachable whatever the minimum.
      const zoom = h('input', { type: 'range', min: String(full / whole), max: String(ZOOM_MAX), step: 'any', value: '1', id: 'strv-badges-zoom', class: 'strv-badges__zoom' });
      zoom.addEventListener('input', () => move(view.x, view.y, full / Number(zoom.value)));

      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', 'Your photo inside the Fair Maps ring. Drag it, or use the arrow keys, to move it.');
      canvas.setAttribute('tabindex', '0');
      canvas.classList.add('strv-badges__canvas');
      let drag: { id: number; x: number; y: number } | null = null;
      canvas.addEventListener('pointerdown', (e) => {
        // Only the main mouse button drags; a right click opens the menu and may never send its pointerup.
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
        canvas.setPointerCapture?.(e.pointerId);
      });
      canvas.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        // A mouse whose button came up somewhere this canvas never heard about is no longer dragging.
        if (e.pointerType === 'mouse' && e.buttons === 0) {
          drag = null;
          return;
        }
        // Screen pixels to photo pixels: the canvas shows `view.side` photo pixels across its drawn width.
        const scale = view.side / (canvas.clientWidth || FRAME_SIZE);
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        drag.x = e.clientX;
        drag.y = e.clientY;
        move(view.x - dx * scale, view.y - dy * scale, view.side);
      });
      const endDrag = (e: PointerEvent): void => {
        if (drag?.id === e.pointerId) drag = null;
      };
      canvas.addEventListener('pointerup', endDrag);
      canvas.addEventListener('pointercancel', endDrag);
      canvas.addEventListener('lostpointercapture', endDrag);
      canvas.addEventListener('keydown', (e) => {
        // Alt+arrow is the browser's back and forward; leave modified keys alone.
        if (e.altKey || e.ctrlKey || e.metaKey) return;
        const step = view.side * NUDGE;
        const by: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        const d = by[e.key];
        if (!d) return;
        e.preventDefault();
        // An arrow moves the photo itself that way, so the shown square moves the other way.
        move(view.x - d[0], view.y - d[1], view.side);
      });

      paint();
      if (!(await encode())) return;
      result.replaceChildren(
        canvas,
        h('p', { class: 'strv-badges__hint' }, 'Drag the photo to move it inside the ring.'),
        h('div', { class: 'strv-badges__zoom-row' }, h('label', { class: 'strv-badges__label', for: 'strv-badges-zoom' }, 'Zoom'), zoom),
        link,
      );
    } catch {
      if (current(mine)) fail(MAKE_FAILED);
    }
  }

  const post = h('textarea', { class: 'strv-badges__code', id: 'strv-badges-post', readonly: true, rows: 3, spellcheck: false });
  post.value = post.defaultValue = RING_POST;

  const el = h(
    'article',
    { class: 'strv-badges__frame', 'aria-labelledby': 'strv-badges-frame-h' },
    h('h2', { class: 'strv-badges__h', id: 'strv-badges-frame-h' }, 'Profile picture ring'),
    h('p', null, 'Put the Fair Maps ring around your profile picture on social media. Choose a photo to see it in the ring and download it, or download the ring on its own.'),
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
    h('label', { class: 'strv-badges__label', for: 'strv-badges-post' }, 'Post this with your new picture, or put it in your bio'),
    h('p', null, 'A profile picture can’t carry a link. This line gives people one to tap, so they can find the site and get the ring too.'),
    post,
    copyControl(post).button,
  );
  return {
    el,
    destroy: () => {
      gone = true;
      drop();
      revoke();
    },
  };
}

/** Badges anyone can use: a ring for a profile picture, and badges for a website, each with the code to paste and the files to download. */
export function createBadgesPage(load: () => Promise<StateIndex> = loadIndex, frameDeps: FrameDeps = browserDeps): Page {
  const picker = statePicker(load);
  const frame = frameCard(frameDeps);
  const h1 = h('h1', { class: 'strv-how__h1', tabindex: -1 }, 'Fair Maps badges');
  const el = h(
    'main',
    { class: 'strv-how strv-badges', id: 'strv-main' },
    h(
      'header',
      { class: 'strv-how__head' },
      h('a', { href: routeHref(NATIONAL), class: 'strv-back' }, iconArrowLeft(), 'All states'),
      h1,
      h('p', { class: 'strv-how__lede' }, 'Show that you back fair maps. Put the Fair Maps ring on your profile picture, or a badge on your website or campaign site.'),
    ),
    h('div', { class: 'strv-badges__grid' }, frame.el),
    h(
      'section',
      { class: 'strv-badges__site', 'aria-labelledby': 'strv-badges-site-h' },
      h('h2', { class: 'strv-badges__h', id: 'strv-badges-site-h' }, 'For your website'),
      h(
        'p',
        null,
        'Each badge is a picture with a link back here, with no script. When a page shows a badge, we note that page’s address, ',
        h('a', { href: routeHref(PRIVACY) }, 'never who visited'),
        ', and list the site on ',
        h('a', { href: routeHref(PLEDGES) }, 'Sites that show the badge'),
        '.',
      ),
      h('div', { class: 'strv-badges__grid' }, ...FIXED.map((f) => badgeCard(() => ({ id: f.id, theme: 'light' }), f.title).el)),
    ),
    picker.el,
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
