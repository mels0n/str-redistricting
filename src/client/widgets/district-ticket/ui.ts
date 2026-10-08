import { h, clear, announce, formatInt, peopleNoun, type Plan } from '../../shared';
import { fromEven, describeFromEven, evenSplitSentence, type DistrictStats } from '../../entities/plan';

export interface TicketData {
  district: DistrictStats | null;
  color: string | null;
  /** The state's population and seats: an even split is total ÷ seats, in whole people. */
  total: number;
  seats: number;
  plan: Plan;
  /** True when this is the district of the address the visitor looked up. */
  located: boolean;
  /** True while the visitor is only pointing at the district. */
  preview: boolean;
  /** Names the moment shown, when it is not simply a plan (the balancing replay). */
  stage?: string;
  /** True partway through the balancing replay: counties and contiguity are those of the plan before balancing. */
  partway?: boolean;
  /** True when an island link of the plan shown has both ends in this district. */
  linked?: boolean;
}

export interface DistrictTicket {
  el: HTMLElement;
  update(data: TicketData): void;
}

/** What the card says about the district's connection (the sentence before any before-balancing suffix). */
export function connectionText(d: Pick<DistrictStats, 'contiguous' | 'landParts'>, linked: boolean): string {
  if (!d.contiguous) return 'Not one connected piece';
  const water = (d.landParts ?? 1) > 1;
  if (water && linked) return 'One connected piece, joined across water and by a link to the nearest land';
  if (water) return 'One connected piece, joined across water';
  if (linked) return 'One connected piece, joined by a link to the nearest land';
  return 'One connected piece';
}

function describeDistrict(d: DistrictStats, total: number, seats: number): string {
  return `District ${d.district}. Population ${formatInt(d.pop)}, ${describeFromEven(fromEven(d.pop, total, seats).delta)}. Touches ${d.counties.length} ${d.counties.length === 1 ? 'county' : 'counties'}.`;
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
      if (announced !== undefined && d) announce(describeDistrict(d, data.total, data.seats));
      announced = chosen;
    }
    el.dataset.empty = String(!d);
    el.dataset.preview = String(data.preview);
    if (!d) {
      el.append(
        h('p', { class: 'strv-ticket__empty' }, 'Select a district on the map or in the list to see its population, how far it is from an even split and the counties it touches.'),
      );
      return;
    }
    const off = fromEven(d.pop, data.total, data.seats);
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
          h('dt', null, 'From an even split'),
          h('dd', null, `${off.label} `, h('span', { class: 'strv-ticket__unit' }, peopleNoun(off.delta))),
          h('dd', { class: 'strv-ticket__sub' }, `${off.delta === 0 ? '' : `${off.pct} from an even split. `}${evenSplitSentence(data.total, data.seats)}.`),
        ),
        h(
          'div',
          { class: 'strv-ticket__seg strv-ticket__seg--wide' },
          h('dt', null, `${counties.length === 1 ? 'County' : 'Counties'} touched${data.partway ? ' before balancing' : ''} (${counties.length})`),
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
      h('p', { class: 'strv-ticket__foot' }, `${connectionText(d, data.linked ?? false)}${data.partway ? ' before balancing' : ''}. ${data.stage ?? (data.plan === 'finished' ? 'Finished map.' : 'Before balancing.')}`),
    );
  }

  return { el, update };
}
