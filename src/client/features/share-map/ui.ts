import { h, announce, config, iconShare, sharePath, type Chamber } from '../../shared';

/** The map being shared: one state, one chamber. */
export interface ShareTarget {
  readonly abbr: string;
  readonly name: string;
  readonly seats: number;
  readonly chamber: Chamber;
}

export interface ShareContent {
  readonly url: string;
  readonly title: string;
  readonly text: string;
}

/** The link points at the state's share page, whose preview image shows that state's districts; people opening it land on the map. */
export function shareContent(t: ShareTarget): ShareContent {
  const body = t.chamber === 'federal-house' ? 'congressional' : t.chamber === 'state-senate' ? 'state senate' : 'state house';
  return {
    url: `https://${config.siteHost}${sharePath(t.abbr, t.chamber)}`,
    title: `${t.name}: districts drawn by Fair Maps`,
    text: `${t.name}'s ${t.seats} ${body} ${t.seats === 1 ? 'district' : 'districts'}. ${config.tagline}`,
  };
}

export interface ShareButton {
  readonly el: HTMLElement;
  /** The map to share, or null to hide the button (no map on screen). */
  set(target: ShareTarget | null): void;
}

/** How long the button says "Link copied" before it reads "Share" again. */
const COPIED_MS = 2500;

/**
 * Share this map. On a touch screen with a share sheet, the sheet opens; everywhere else the link is copied.
 * If copying is refused, the link is shown selected so it can be copied by hand.
 */
export function createShareButton(): ShareButton {
  const label = h('span', null, 'Share');
  const button = h('button', { type: 'button', class: 'strv-share__button' }, iconShare(), label);
  const manual = h('input', { type: 'text', class: 'strv-share__manual', readonly: true, 'aria-label': 'Link to this map', hidden: true });
  const el = h('span', { class: 'strv-share', hidden: true }, button, manual);
  let target: ShareTarget | null = null;
  let resetTimer = 0;

  const say = (text: string): void => {
    label.textContent = text;
    window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => (label.textContent = 'Share'), COPIED_MS);
  };

  const copy = async (url: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      say('Link copied');
      announce('Link copied');
    } catch {
      manual.value = url;
      manual.hidden = false;
      manual.focus();
      manual.select();
      announce('Copy the selected link');
    }
  };

  button.addEventListener('click', () => {
    if (!target) return;
    const content = shareContent(target);
    const sheet = typeof navigator.share === 'function' && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    if (!sheet) {
      void copy(content.url);
      return;
    }
    navigator.share(content).catch((err: unknown) => {
      // Closing the sheet is a choice, not a failure.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      void copy(content.url);
    });
  });

  return {
    el,
    set(next) {
      target = next;
      el.hidden = next === null;
      manual.hidden = true;
      label.textContent = 'Share';
    },
  };
}
