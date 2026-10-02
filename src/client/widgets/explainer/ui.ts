import { h, formatHash, howRoute } from '../../shared';

/**
 * "How this map was drawn": the rule in plain language. It matches the
 * generator's published rules and says nothing the generator does not do.
 */
export function createExplainer(opts: { seats?: number } = {}): HTMLElement {
  const n = opts.seats;
  const cuts = n !== undefined ? `${n - 1} ${n - 1 === 1 ? 'cut' : 'cuts'} for ${n} seats` : 'one cut fewer than the number of seats';
  const step = (title: string, text: string): HTMLElement => h('li', null, h('strong', null, title), ' ', text);
  return h(
    'section',
    { class: 'strv-explain', 'aria-labelledby': 'strv-explain-h' },
    h('h2', { id: 'strv-explain-h', class: 'strv-h2' }, 'How this map was drawn'),
    h(
      'ol',
      { class: 'strv-explain__steps' },
      step(
        'Only people and shapes.',
        'For each 2020 census block the generator reads the number of people, the block’s shape, and its center point (the internal point the Census Bureau publishes), which it uses only to put blocks in order across a guide line. It never reads party registration, election results, the addresses of officeholders, or race and ethnicity data.',
      ),
      step(
        'Split by the shortest line.',
        'A piece of the state with several seats is split in two, with the seats shared as evenly as possible (7 seats become 3 and 4). Straight guide lines are tried in every direction, one every 0.1 degrees, each placed so the people on each side match that side’s seats. The line whose real border is shortest wins.',
      ),
      step(
        'Blocks stay whole.',
        'The real border follows census block edges, so it is not perfectly straight. Stray pieces cut off from their side join the side around them, and the line slides so the people still split evenly. Both sides must be one connected piece.',
      ),
      step('Repeat until each piece has one seat.', `Each piece is split again until every piece is one district. That takes ${cuts}.`),
      step(
        'Balance.',
        'Single blocks along the borders then move to the neighboring district when that narrows the population gap between the two, and only when both stay connected.',
      ),
      step(
        'Same data, same map.',
        'There is no randomness and no human choice. Anyone who runs the generator on the same census files gets the same map, down to the fingerprint.',
      ),
    ),
    h('p', { class: 'strv-explain__more' }, h('a', { href: formatHash(howRoute()) }, 'How it works: every stage, with drawings')),
  );
}
