import { h, clear } from '../../shared';
import { loadNotes, type PublicNote } from '../../entities/notes';

export type VoicesScope = { key: string } | { national: true };

export interface Voices {
  el: HTMLElement;
  /** Settles once the notes have been asked for and shown (or not). */
  ready: Promise<void>;
  destroy(): void;
}

const dateOf = (at: string): string => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
};

/** The name and town of a note's writer; a town never appears without a name. */
const byline = (n: PublicNote): string => (n.name ? [n.name, n.town].filter((s): s is string => Boolean(s)).join(', ') : '');

/**
 * Recent "why I signed" notes under a heading. The section stays empty and hidden until notes arrive, and a failed fetch or
 * no notes leaves it that way: the page around it never shows an error for it.
 */
export function createVoices(input: { scope: VoicesScope; heading: string; limit?: number }): Voices {
  const el = h('section', { class: 'strv-voices', hidden: true });
  let dead = false;
  const ready = loadNotes(input.scope).then((notes) => {
    if (dead || !notes || notes.length === 0) return;
    clear(el);
    const list = h('ul', { class: 'strv-voices__list' });
    for (const n of notes.slice(0, input.limit ?? 10)) {
      const by = byline(n);
      const when = dateOf(n.at);
      list.append(
        h(
          'li',
          { class: 'strv-voices__item' },
          h('blockquote', { class: 'strv-voices__quote' }, n.body),
          (by || when) && h('p', { class: 'strv-voices__by' }, [by, when].filter(Boolean).join(', ')),
        ),
      );
    }
    el.append(h('h3', { class: 'strv-voices__h' }, input.heading), list);
    el.hidden = false;
  });
  return {
    el,
    ready,
    destroy() {
      dead = true;
    },
  };
}
