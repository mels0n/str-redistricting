import { h, clear, chunkDigest, formatInt, formatPeople, formatPct, peopleNoun, type Plan } from '../../shared';
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
      body.append(
        h(
          'dl',
          { class: 'strv-proof__rows' },
          row(
            'Population range',
            `${formatPeople(m.rangePersons)} ${peopleNoun(m.rangePersons)}`,
            `The gap between the largest and smallest district: ${formatPct(m.rangePct)} of a district. ${evenSplitSentence(m.population, m.seats)}.`,
          ),
          row(
            'Connected districts',
            m.allContiguous ? 'All' : 'Not all',
            m.allContiguous ? `Each of the ${m.seats} districts is one connected piece.` : 'At least one district is in more than one piece.',
          ),
          row(
            'Balancing moves',
            formatInt(m.balanceMoves),
            before
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
          row(
            'Run with',
            `Node.js ${m.nodeVersion}`,
            `Guide lines every ${m.angleStepDeg} degrees, ${formatInt(steps)} directions for each cut.`,
          ),
        ),
        h(
          'div',
          { class: 'strv-proof__recipe' },
          h('p', null, 'To reproduce this map, run the generator on the same Census file:'),
          h('pre', { class: 'strv-code', tabindex: 0, role: 'group', 'aria-label': 'Command to run' }, h('code', null, `npm install\nnpm run explore -- --states ${abbr}`)),
          h('p', null, 'The same data, angle step and Node.js major version give a byte-identical map with the same fingerprint. No random numbers are used.'),
        ),
      );
    },
  };
}
