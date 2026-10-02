import { h, formatHash, stateRoute, formatInt, formatPeople, peopleNoun } from '../../shared';
import { byName, isGenerated, type StateIndex } from '../../entities/state';

/**
 * The numbered state index. Every state is listed alphabetically with its
 * number of House seats; states with a generated map are links and show
 * their population range, the others say plainly that the map has not been
 * generated.
 */
export function createStateIndex(index: StateIndex): HTMLElement {
  const states = byName(index);
  const generated = states.filter(isGenerated);

  const rows = states.map((s, i) => {
    const n = String(i + 1).padStart(2, '0');
    if (isGenerated(s)) {
      const range = s.summary.rangePersons;
      return h(
        'li',
        { class: 'strv-index__row', 'data-generated': 'true' },
        h(
          'a',
          { href: formatHash(stateRoute(s.abbr)), class: 'strv-index__link' },
          h('span', { class: 'strv-index__n' }, n),
          h('span', { class: 'strv-index__code' }, s.abbr),
          h('span', { class: 'strv-index__name' }, s.name),
          h('span', { class: 'strv-index__seats' }, h('span', { class: 'strv-index__num' }, String(s.seats)), ` ${s.seats === 1 ? 'seat' : 'seats'}`),
          h('span', { class: 'strv-index__range' }, `Range ${formatPeople(range)} ${peopleNoun(range)}`),
        ),
      );
    }
    return h(
      'li',
      { class: 'strv-index__row', 'data-generated': 'false' },
      h('span', { class: 'strv-index__n' }, n),
      h('span', { class: 'strv-index__code' }, s.abbr),
      h('span', { class: 'strv-index__name' }, s.name),
      h('span', { class: 'strv-index__seats' }, h('span', { class: 'strv-index__num' }, String(s.seats)), ` ${s.seats === 1 ? 'seat' : 'seats'}`),
      h('span', { class: 'strv-index__range' }, 'Map not generated'),
    );
  });

  const totalSeats = generated.reduce((a, s) => a + s.seats, 0);
  return h(
    'nav',
    { class: 'strv-index', 'aria-labelledby': 'strv-index-h' },
    h('h2', { id: 'strv-index-h', class: 'strv-index__h' }, 'States'),
    h(
      'p',
      { class: 'strv-index__lede' },
      generated.length === states.length
        ? `Maps are available for all ${states.length} states, covering all ${formatInt(totalSeats)} House seats.`
        : `Maps have been generated for ${generated.length} states, ${formatInt(totalSeats)} of the 435 House seats. The others are listed without a map.`,
    ),
    h('ol', { class: 'strv-index__list' }, rows),
  );
}
