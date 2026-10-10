import { h, formatHash, faqRoute, howRoute } from '../../shared';

/**
 * "How this map was drawn": the method in plain language. It matches the
 * generator's published rules and says nothing the generator does not do.
 */
export function createExplainer(opts: { seats?: number } = {}): HTMLElement {
  const n = opts.seats;
  const cuts = n !== undefined ? `${n - 1} ${n - 1 === 1 ? 'cut' : 'cuts'} for ${n} ${n === 1 ? 'seat' : 'seats'}` : 'one cut fewer than the number of seats';
  const step = (title: string, text: string): HTMLElement => h('li', null, h('strong', null, title), ' ', text);
  return h(
    'section',
    { class: 'strv-explain', 'aria-labelledby': 'strv-explain-h' },
    h('h2', { id: 'strv-explain-h', class: 'strv-h2' }, 'How this map was drawn'),
    h(
      'p',
      { class: 'strv-explain__note' },
      h('strong', null, 'Only people and shapes.'),
      ' For each 2020 census block the generator reads the number of people, the block’s shape, and its center point (the internal point the Census Bureau publishes), which it uses only to put blocks in order across a guide line. It never reads party registration or voter records, election results or turnout, where officeholders or candidates live, current or past district lines, or race, ethnicity, age, income or anything else about people besides how many there are.',
    ),
    h(
      'ol',
      { class: 'strv-explain__steps' },
      step(
        'Cut.',
        n === 1
          ? 'This state has one seat, so it needs no cut: the whole state is its one district.'
          : `A piece with several seats is split in two, with the seats shared as evenly as possible (7 seats become 3 and 4). Straight guide lines are tried in every direction, one every 0.1 degrees, each placed so the people on each side match that side’s seats. The line whose real border is shortest wins. Each piece is cut again until every piece is one district. That takes ${cuts}.`,
      ),
      step(
        'Keep blocks whole.',
        'The real border follows census block edges, so it is not perfectly straight. Stray pieces cut off from their side join the side around them, and the line slides so the people still split evenly. Both sides must be one connected piece.',
      ),
      step(
        'Balance.',
        'Single blocks along the borders then move to the neighboring district when that narrows the population gap between the two, and only when both stay connected.',
      ),
    ),
    h(
      'p',
      { class: 'strv-explain__note strv-explain__note--end' },
      h('strong', null, 'Same data, same map.'),
      ' There is no randomness and no human choice. Anyone who runs the generator on the same census files gets the same map, down to the fingerprint.',
    ),
    h('p', { class: 'strv-explain__more' }, h('a', { href: formatHash(howRoute()) }, 'How it works: every stage, with drawings')),
    h('p', { class: 'strv-explain__more strv-explain__more--next' }, h('a', { href: formatHash(faqRoute('strange')) }, 'District look strange? Here’s why')),
  );
}
