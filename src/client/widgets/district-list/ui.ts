import { h, clear, formatInt, formatSignedPeople, formatPct } from '../../shared';
import type { DistrictStats } from '../../entities/plan';

export interface DistrictListOptions {
  onSelect(district: number): void;
}

export interface DistrictList {
  el: HTMLElement;
  update(data: { districts: DistrictStats[]; colors: string[]; selected: number | null; located: number | null; caption: string }): void;
}

/**
 * Every district on the map, as a table. This is also the complete text
 * view of the map: each row selects its district.
 */
export function createDistrictList(opts: DistrictListOptions): DistrictList {
  const caption = h('caption', { class: 'strv-list__caption' });
  const body = h('tbody');
  const table = h(
    'table',
    { class: 'strv-list' },
    caption,
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        h('th', { scope: 'col', class: 'strv-list__no' }, 'No.'),
        h('th', { scope: 'col', class: 'strv-list__num' }, 'Population'),
        h('th', { scope: 'col', class: 'strv-list__num' }, 'From ideal'),
        h('th', { scope: 'col', class: 'strv-list__num strv-list__pct' }, '%'),
        h('th', { scope: 'col', class: 'strv-list__num' }, 'Counties'),
      ),
    ),
    body,
  );
  const scroll = h('div', { class: 'strv-list-scroll' }, table);
  const el = h('section', { class: 'strv-list-wrap', 'aria-labelledby': 'strv-list-h' }, h('h2', { id: 'strv-list-h', class: 'strv-h2' }, 'Districts'), scroll);

  // When enlarged text makes the table wider than its column it scrolls sideways; make that box reachable by keyboard.
  const fit = (): void => {
    const wide = scroll.scrollWidth > scroll.clientWidth + 1;
    if (wide) {
      scroll.tabIndex = 0;
      scroll.setAttribute('role', 'group');
      scroll.setAttribute('aria-label', 'Districts table, scrolls sideways');
    } else {
      scroll.removeAttribute('tabindex');
      scroll.removeAttribute('role');
      scroll.removeAttribute('aria-label');
    }
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(fit).observe(scroll);

  return {
    el,
    update({ districts, colors, selected, located, caption: cap }) {
      caption.textContent = cap;
      clear(body);
      window.requestAnimationFrame(fit);
      for (const d of districts) {
        const isSel = d.district === selected;
        const button = h(
          'button',
          {
            type: 'button',
            class: 'strv-list__pick',
            'aria-pressed': String(isSel),
            'aria-label': `District ${d.district}${located === d.district ? ', your address' : ''}`,
            onclick: () => opts.onSelect(d.district),
          },
          h('span', { class: 'strv-list__swatch', style: `background:${colors[d.district - 1] ?? 'transparent'}`, 'aria-hidden': 'true' }),
          h('span', null, String(d.district)),
          located === d.district ? h('span', { class: 'strv-list__you', 'aria-hidden': 'true' }, 'You') : null,
        );
        body.append(
          h(
            'tr',
            { 'data-selected': String(isSel) },
            h('th', { scope: 'row', class: 'strv-list__no' }, button),
            h('td', { class: 'strv-list__num' }, formatInt(d.pop)),
            h('td', { class: 'strv-list__num' }, formatSignedPeople(d.dev)),
            h('td', { class: 'strv-list__num strv-list__pct' }, formatPct(d.devPct, true)),
            h('td', { class: 'strv-list__num' }, String(d.counties.length)),
          ),
        );
      }
    },
  };
}
