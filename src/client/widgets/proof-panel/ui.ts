import { h, clear, chunkDigest, config, reproduceCommands, formatInt, formatPeople, formatPct, peopleNoun, type Plan } from '../../shared';
import { evenSplitSentence, type Metrics } from '../../entities/plan';

export interface ProofPanel {
  el: HTMLElement;
  update(data: { metrics: Metrics; plan: Plan; abbr: string }): void;
}

function digestBlock(hex: string, label: string): HTMLElement {
  const lines = chunkDigest(hex).map((groups) => groups.join(' '));
  return h('pre', { class: 'strv-digest', role: 'img', 'aria-label': `${label}: ${hex}` }, h('code', { 'aria-hidden': 'true' }, lines.join('\n')));
}

function row(term: string, fig: Node | string, sub: string, extraClass = ''): HTMLElement {
  return h(
    'div',
    { class: `strv-proof__row ${extraClass}`.trim() },
    h('dt', null, term),
    h('dd', null, typeof fig === 'string' ? h('span', { class: 'strv-proof__fig' }, fig) : fig, h('span', { class: 'strv-proof__sub' }, sub)),
  );
}

/**
 * The numbers anyone can check: population range, contiguity, the map's
 * fingerprint and the recipe that reproduces it.
 */
export function createProofPanel(): ProofPanel {
  const body = h('div', { class: 'strv-proof__body' });
  const el = h(
    'section',
    { class: 'strv-proof', 'aria-labelledby': 'strv-proof-h' },
    h('h2', { id: 'strv-proof-h', class: 'strv-h2' }, 'Check this map'),
    body,
  );

  return {
    el,
    update({ metrics: m, plan, abbr }) {
      clear(body);
      const steps = Math.round(180 / m.angleStepDeg);
      const before = plan === 'before';
      const single = m.seats === 1;
      body.append(
        h(
          'dl',
          { class: 'strv-proof__rows' },
          row(
            'Population range',
            `${formatPeople(m.rangePersons)} ${peopleNoun(m.rangePersons)}`,
            `The gap between the largest and smallest district, as a percent of the ideal district population: ${formatPct(m.rangePct)}. ${evenSplitSentence(m.population, m.seats)}.`,
          ),
          row(
            'Connected districts',
            m.allContiguous ? 'All' : 'Not all',
            m.allContiguous ? (single ? 'The district is one connected piece.' : `Each of the ${m.seats} districts is one connected piece.`) : 'At least one district is in more than one piece.',
          ),
          row(
            'Balancing moves',
            formatInt(m.balanceMoves),
            single
              ? 'None: with one district there is nothing to balance.'
              : before
              ? 'None: this is the plan as the cuts left it.'
              : `Single census blocks moved between neighboring districts after the cuts, out of ${formatInt(m.blocks)} blocks.`,
          ),
          row(
            'Map fingerprint',
            digestBlock(m.assignmentSha256, 'Map fingerprint'),
            `SHA-256 of the file that assigns every census block to a district${before ? ', before balancing' : ''}. Run the generator yourself and compare.`,
            'strv-proof__row--digest',
          ),
          row(
            'Census input',
            digestBlock(m.inputSha256, 'Census input checksum'),
            'SHA-256 of the 2020 Census block file the map was drawn from.',
            'strv-proof__row--digest',
          ),
          single
            ? row('Guide lines', 'None', 'A state with one seat needs no cut, so no guide line is drawn.')
            : row('Guide lines', `Every ${m.angleStepDeg}°`, `${formatInt(steps)} directions tried for each cut.`),
        ),
        h(
          'div',
          { class: 'strv-proof__recipe' },
          h('p', null, 'To reproduce this map, get the generator’s code from ', h('a', { href: config.repoUrl }, 'its GitHub repository'), ' and run it on the same Census file:'),
          h('pre', { class: 'strv-code', tabindex: 0, role: 'group', 'aria-label': 'Commands to run' }, h('code', null, reproduceCommands(abbr))),
          h('p', null, 'The same data and the same steps give a byte-identical map with the same fingerprint, on any computer. No random numbers are used.'),
        ),
      );
    },
  };
}
