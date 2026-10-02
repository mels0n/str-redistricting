import { h, clear, announce, formatInt, formatPeople, formatSignedPeople, formatPct, peopleNoun, type Plan } from '../../shared';
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
  /** Names the moment shown, when it is not simply a plan (the balancing replay). */
  stage?: string;
}

export interface DistrictTicket {
  el: HTMLElement;
  update(data: TicketData): void;
}

function describeDistrict(d: DistrictStats, ideal: number): string {
  const gap = d.dev === 0 ? 'exactly the ideal' : `${formatPeople(Math.abs(d.dev))} ${peopleNoun(d.dev)} ${d.dev > 0 ? 'above' : 'below'} the ideal of ${formatPeople(ideal)}`;
  return `District ${d.district}. Population ${formatInt(d.pop)}, ${gap}. Touches ${d.counties.length} ${d.counties.length === 1 ? 'county' : 'counties'}.`;
}

/**
 * The district ticket: one district's numbers as a segmented strip, every
 * figure tabular so tickets line up when compared.
 */
export function createDistrictTicket(): DistrictTicket {
  // Not a live region: the numbers change as the pointer passes over districts. A chosen district is announced once, below.
  const el = h('section', { class: 'strv-ticket', 'aria-label': 'Selected district' });
  let announced: string | null | undefined;

  function update(data: TicketData): void {
    clear(el);
    const d = data.district;
    // Say what a visitor chose (not what the pointer passes over). The first render is the page opening, not a choice.
    const chosen = data.preview || !d ? null : `${d.district}|${data.plan}`;
    if (!data.preview && chosen !== announced) {
      if (announced !== undefined && d) announce(describeDistrict(d, data.ideal));
      announced = chosen;
    }
    el.dataset.empty = String(!d);
    el.dataset.preview = String(data.preview);
    if (!d) {
      el.append(
        h('p', { class: 'strv-ticket__empty' }, 'Select a district on the map or in the list to see its population, its difference from the ideal and the counties it touches.'),
      );
      return;
    }
    const counties = d.counties.map((c) => c.name);
    // Every county is listed; a long list scrolls inside its own box, which keyboard users can reach.
    const long = counties.length > 8;
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
          h(
            'dd',
            { class: 'strv-ticket__counties' },
            h(
              'div',
              {
                class: 'strv-ticket__counties-text',
                'data-long': String(long),
                tabindex: long ? 0 : null,
                role: long ? 'group' : null,
                'aria-label': long ? 'All ' + counties.length + ' counties in District ' + d.district : null,
              },
              counties.join(', '),
            ),
          ),
        ),
      ),
      h('p', { class: 'strv-ticket__foot' }, `${d.contiguous ? 'One connected piece.' : 'Not one connected piece.'} ${data.stage ?? (data.plan === 'finished' ? 'Finished map.' : 'Before balancing.')}`),
    );
  }

  return { el, update };
}
