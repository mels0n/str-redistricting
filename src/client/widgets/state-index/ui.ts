import { h, formatHash, stateRoute, formatInt, formatPeople, peopleNoun, chamberSeatsNoun, type Chamber } from '../../shared';
import { byName, chamberView, isGeneratedIn, type StateIndex } from '../../entities/state';

/**
 * The numbered state index. Every state is listed alphabetically with its
 * number of House seats; states with a generated map are links and show
 * their population range, the others say plainly that the map has not been
 * generated.
 */
export function createStateIndex(index: StateIndex, chamber: Chamber = 'federal-house'): HTMLElement {
  // A state with no such chamber (Nebraska's State House) is not listed for it.
  const states = byName(index).filter((s) => chamber === 'federal-house' || s.chambers === undefined || chamberView(s, chamber).seats > 0);
  const generated = states.filter((s) => isGeneratedIn(s, chamber));
  const noun = (n: number): string => (chamber === 'federal-house' ? (n === 1 ? 'seat' : 'seats') : n === 1 ? 'district' : 'districts');

  const rows = states.map((s, i) => {
    const n = String(i + 1).padStart(2, '0');
    const v = chamberView(s, chamber);
    if (isGeneratedIn(s, chamber)) {
      const range = v.summary!.rangePersons;
      return h(
        'li',
        { class: 'strv-index__row', 'data-generated': 'true' },
        h(
          'a',
          { href: formatHash(stateRoute(s.abbr, { chamber })), class: 'strv-index__link' },
          h('span', { class: 'strv-index__n' }, n),
          h('span', { class: 'strv-index__code' }, s.abbr),
          h('span', { class: 'strv-index__name' }, s.name),
          h('span', { class: 'strv-index__seats' }, h('span', { class: 'strv-index__num' }, String(v.seats)), ` ${noun(v.seats)}`),
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
      h('span', { class: 'strv-index__seats' }, h('span', { class: 'strv-index__num' }, String(v.seats)), ` ${noun(v.seats)}`),
      h('span', { class: 'strv-index__range' }, 'Map not generated'),
    );
  });

  const totalSeats = generated.reduce((a, s) => a + chamberView(s, chamber).seats, 0);
  return h(
    'nav',
    { class: 'strv-index', 'aria-labelledby': 'strv-index-h' },
    h('h2', { id: 'strv-index-h', class: 'strv-index__h' }, 'States'),
    h(
      'p',
      { class: 'strv-index__lede' },
      chamber !== 'federal-house'
        ? generated.length === states.length
          ? `Maps are available for all ${states.length} states with this chamber, covering ${formatInt(totalSeats)} ${chamberSeatsNoun(chamber, totalSeats)}.`
          : `Maps have been drawn for ${generated.length} of ${states.length} states, covering ${formatInt(totalSeats)} ${chamberSeatsNoun(chamber, totalSeats)}. The others are listed without a map.`
        : generated.length === states.length
          ? `Maps are available for all ${states.length} states, covering all ${formatInt(totalSeats)} House seats.`
          : `Maps have been generated for ${generated.length} states, ${formatInt(totalSeats)} of the 435 House seats. The others are listed without a map.`,
    ),
    h('ol', { class: 'strv-index__list' }, rows),
  );
}
