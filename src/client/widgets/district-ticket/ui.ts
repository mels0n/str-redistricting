import { h, clear, formatInt, formatPeople, formatSignedPeople, formatPct, peopleNoun, type Plan } from '../../shared';
import type { DistrictStats } from '../../entities/plan';

export interface TicketData {
  district: DistrictStats | null;
  color: string | null;
  ideal: number;
  plan: Plan;
  /** True when this is the district of the address the visitor looked up. */
  located: boolean;
  /** True while the visitor is only pointing at the district. */
  preview: boolean;
}

export interface DistrictTicket {
  el: HTMLElement;
  update(data: TicketData): void;
}

/**
 * The district ticket: one district's numbers as a segmented strip, every
 * figure tabular so tickets line up when compared.
 */
export function createDistrictTicket(): DistrictTicket {
  const el = h('section', { class: 'strv-ticket', 'aria-label': 'Selected district', 'aria-live': 'polite' });

  function update(data: TicketData): void {
    clear(el);
    const d = data.district;
    el.dataset.empty = String(!d);
    el.dataset.preview = String(data.preview);
    if (!d) {
      el.append(
        h('p', { class: 'strv-ticket__empty' }, 'Select a district on the map or in the list to see its population, its difference from the ideal and the counties it touches.'),
      );
      return;
    }
    const counties = d.counties.map((c) => c.name);
    const shown = counties.slice(0, 6);
    const more = counties.length - shown.length;
    el.append(
      h(
        'div',
        { class: 'strv-ticket__seg strv-ticket__seg--id' },
        h('span', { class: 'strv-ticket__swatch', style: `background:${data.color ?? 'transparent'}`, 'aria-hidden': 'true' }),
        h('span', { class: 'strv-ticket__k' }, 'District'),
        h('span', { class: 'strv-ticket__no' }, String(d.district)),
        data.located ? h('span', { class: 'strv-ticket__flag' }, 'Your address') : null,
      ),
      h(
        'dl',
        { class: 'strv-ticket__figs' },
        h('div', { class: 'strv-ticket__seg' }, h('dt', null, 'Population'), h('dd', null, formatInt(d.pop))),
        h(
          'div',
          { class: 'strv-ticket__seg' },
          h('dt', null, 'From the ideal'),
          h('dd', null, `${formatSignedPeople(d.dev)} `, h('span', { class: 'strv-ticket__unit' }, peopleNoun(d.dev))),
          h('dd', { class: 'strv-ticket__sub' }, `${formatPct(d.devPct, true)} of ${formatPeople(data.ideal)}`),
        ),
        h(
          'div',
          { class: 'strv-ticket__seg strv-ticket__seg--wide' },
          h('dt', null, `${counties.length === 1 ? 'County' : 'Counties'} touched (${counties.length})`),
          h('dd', { class: 'strv-ticket__counties' }, shown.join(', ') + (more > 0 ? `, and ${more} more` : '')),
        ),
      ),
      h('p', { class: 'strv-ticket__foot' }, `${d.contiguous ? 'One connected piece.' : 'Not one connected piece.'} ${data.plan === 'official' ? 'Official map.' : 'Before balancing.'}`),
    );
  }

  return { el, update };
}
