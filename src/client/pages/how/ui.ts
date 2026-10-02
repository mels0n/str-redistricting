import {
  h,
  clear,
  describeError,
  formatHash,
  formatInt,
  howRoute,
  iconArrowLeft,
  prefersReducedMotion,
  stateRoute,
  NATIONAL,
  HOW_SECTIONS,
  type HowSection,
  type Page,
  type Route,
} from '../../shared';
import { loadIndex, isGenerated, byName } from '../../entities/state';
import { loadStats, type Metrics } from '../../entities/plan';
import {
  inputsDiagram,
  fanDiagram,
  borderDiagram,
  strayAllowedDiagram,
  strayRejectedDiagram,
  recursionDiagram,
  balanceDiagram,
  fingerprintDiagram,
  sourcesDiagram,
} from './diagrams';

const TITLES: Record<HowSection, string> = {
  inputs: 'What goes in',
  cut: 'One cut',
  strays: 'Stray pieces and the 1% cap',
  recursion: 'Repeat until every piece has one seat',
  balancing: 'Balancing, and why it is needed',
  fingerprint: 'Same data, same map',
  sources: 'Data sources and limits',
};

const sectionId = (s: HowSection): string => `strv-how-${s}`;

const p = (...children: (Node | string)[]): HTMLElement => h('p', null, ...children);
const li = (...children: (Node | string)[]): HTMLElement => h('li', null, ...children);
const code = (t: string): HTMLElement => h('code', { class: 'strv-how__code' }, t);

function figure(caption: string, ...panels: SVGSVGElement[]): HTMLElement {
  return h('figure', { class: 'strv-how__fig', 'data-panels': String(panels.length) }, h('div', { class: 'strv-how__panels' }, panels), h('figcaption', null, caption));
}

function section(id: HowSection, n: number, ...body: (HTMLElement | null)[]): HTMLElement {
  return h(
    'section',
    { class: 'strv-how__section', id: sectionId(id), 'aria-labelledby': `${sectionId(id)}-h` },
    h('h2', { class: 'strv-how__h2', id: `${sectionId(id)}-h`, tabindex: -1 }, h('span', { class: 'strv-how__no', 'aria-hidden': 'true' }, String(n)), TITLES[id]),
    ...body,
  );
}

/** The balancing, state by state, from each state's published numbers. */
function balancingTable(rows: { abbr: string; name: string; m: Metrics }[]): HTMLElement {
  const num = (v: string): HTMLElement => h('td', { class: 'strv-how__num' }, v);
  return h(
    'div',
    { class: 'strv-list-scroll strv-how__table-wrap' },
    h(
      'table',
      { class: 'strv-how__table' },
      h('caption', { class: 'strv-list__caption' }, 'Balancing in every state with a map. Range: the largest district minus the smallest, in people.'),
      h(
        'thead',
        null,
        h(
          'tr',
          null,
          h('th', { scope: 'col' }, 'State'),
          h('th', { scope: 'col', class: 'strv-how__num' }, 'Moves'),
          h('th', { scope: 'col', class: 'strv-how__num' }, 'People moved'),
          h('th', { scope: 'col', class: 'strv-how__num' }, 'Range before'),
          h('th', { scope: 'col', class: 'strv-how__num' }, 'Range after'),
        ),
      ),
      h(
        'tbody',
        null,
        rows.map((r) =>
          h(
            'tr',
            null,
            h('th', { scope: 'row' }, h('a', { href: formatHash(stateRoute(r.abbr, { move: 0 })), 'aria-label': `${r.name}: watch the balancing` }, r.name)),
            num(formatInt(r.m.balanceMoves)),
            num(formatInt(r.m.peopleMovedByBalancing)),
            num(formatInt(r.m.rangeBeforeBalancing)),
            num(formatInt(r.m.rangeAfterBalancing)),
          ),
        ),
      ),
    ),
  );
}

/**
 * How it works: every stage of the rule in plain language, each with a
 * drawing. It says what docs/explanation/how-districts-are-drawn.md says and
 * nothing the generator does not do.
 */
export function createHowPage(initial: Extract<Route, { page: 'how' }>): Page {
  let alive = true;
  const h1 = h('h1', { class: 'strv-how__h1', tabindex: -1 }, 'How the districts are drawn');

  // The balancing figures come from every state's own numbers; they arrive after the page.
  const balanceSentence = h('p', { class: 'strv-how__real' }, 'Loading the numbers for each state…');
  const balanceTable = h('div', { class: 'strv-how__real-table' });

  const toc = h(
    'nav',
    { class: 'strv-how__toc', 'aria-labelledby': 'strv-how-toc-h' },
    h(
      'div',
      { class: 'strv-how__toc-inner' },
      h('h2', { id: 'strv-how-toc-h', class: 'strv-how__toc-h' }, 'Stages'),
      h(
        'ol',
        { class: 'strv-how__toc-list' },
        HOW_SECTIONS.map((s, i) =>
          h('li', null, h('a', { href: formatHash(howRoute(s)), 'data-section': s }, h('span', { class: 'strv-how__toc-no', 'aria-hidden': 'true' }, String(i + 1)), TITLES[s])),
        ),
      ),
    ),
  );

  const body = h(
    'div',
    { class: 'strv-how__body' },
    section(
      'inputs',
      1,
      p('The generator works from the 2020 Census, one census block at a time. A census block is the smallest area the Census Bureau counts people in: often a city block, sometimes a large stretch of open land. For every block in a state it reads three things:'),
      h(
        'ul',
        { class: 'strv-how__list' },
        li('the number of people counted in the block,'),
        li('the block’s shape on the ground, and'),
        li('the block’s internal point, a point inside the block that the Census Bureau publishes (', code('INTPTLAT20'), ' and ', code('INTPTLON20'), '). It is used only to put blocks in order across a guide line.'),
      ),
      figure('Each block brings its shape, its count of people and its internal point. Example numbers.', inputsDiagram()),
      h('h3', { class: 'strv-how__h3' }, 'What is never read'),
      h(
        'ul',
        { class: 'strv-how__list' },
        li('party registration,'),
        li('election results,'),
        li('the addresses of current officeholders,'),
        li('race and ethnicity data.'),
      ),
      p('County and city boundaries are not used to draw anything. Counties are only counted afterwards, for reporting. People are counted where the census counted them, with no adjustments, so a person in a prison is counted at the prison.'),
      p('The number of districts for each state is the number of House seats the state received in the 2020 apportionment.'),
    ),
    section(
      'cut',
      2,
      p('Start with the whole state. Suppose the piece in hand has some number of seats. It is split into two sides that hold as close to half the seats each as possible: a piece with 7 seats is split 3 and 4, a piece with 2 seats is split 1 and 1.'),
      p('The generator tries a straight guide line in every direction, one every 0.1 degrees, starting with north-south: 1,800 directions in all. For each direction, the line is placed so that the people on one side match that side’s share of the seats. When the two shares differ (an odd number of seats), each direction is tried twice, once with the smaller share on each side of the line.'),
      p('A straight line here is a great circle, the path a plane through the center of the Earth traces on its surface, so the lines have no map distortion to argue about. The directions are measured in a flat projection centered on the state, in which every great circle is a straight line.'),
      figure('Guide lines are tried in every direction. Twelve of the 1,800 are drawn here.', fanDiagram()),
      h('h3', { class: 'strv-how__h3' }, 'Blocks stay whole'),
      p('A census block is never split. Once a direction is chosen, the blocks are put in order by how far their internal points sit across the line. The generator walks along that order, adding up people, until the first side holds as close to its share as whole blocks allow. Blocks at the same distance are taken in GEOID order, the census block identifier, so the order is always the same.'),
      p('So the guide line only decides which side each block goes to. The real border follows block edges, because every block belongs entirely to one side.'),
      figure('Each block goes, whole, to the side its internal point is on. The real border follows block edges.', borderDiagram()),
      h('h3', { class: 'strv-how__h3' }, 'The shortest border wins'),
      p('Every guide line becomes a real border, and the generator measures it: the total length of the block edges with one side on each hand, measured along the surface of the Earth. Water inside the state counts as part of the state, so a bay or a lake does not shorten or break a border.'),
      p('Of the lines that pass the checks below (each side in one connected piece, stray pieces within the cap), the one with the shortest real border is used. Two borders whose lengths agree to the nearest centimeter are tied; a tie goes to the line closest to north-south, then to the smaller angle, then to the line whose first side has fewer seats.'),
    ),
    section(
      'strays',
      3,
      p('Because blocks stay whole, a large block that straddles the guide line can leave a few small blocks cut off on the far side. Examples are a median strip or an on-ramp. On each side, every connected group of blocks other than the side’s main body joins the other side, the side around it. The main body is the group with the most people, then the most blocks, then the lowest block position in GEOID order. This repeats until nothing moves.'),
      p('Strays exist only because blocks are kept whole, so they should be small. A guide line through a bay, or across both arms of a U-shaped piece, would strand a real part of the piece and move many people. The stray cap rules such a line out: if the people in the stray pieces total more than 1% of one district’s ideal population for the piece being cut, the line is not used and the next shortest is considered. The ideal population is the piece’s population divided by its number of seats.'),
      h(
        'div',
        { class: 'strv-how__worked' },
        h('h3', { class: 'strv-how__h3' }, 'A worked example'),
        p('Example numbers: a piece with 2 seats and 1,400,000 people. One district’s ideal population is 700,000, so the cap is 1% of that: 7,000 people.'),
      ),
      figure('Left: a small piece cut off inside a large block holds 180 people, under the cap, so the line can be used. Right: a line across both arms of a U cuts off 41,000 people, over the cap, so the line is not used.', strayAllowedDiagram(), strayRejectedDiagram()),
      p('A line may cross the piece’s outline any number of times, as long as it passes the cap. A cut is also accepted only if both of its sides are each one connected piece. Two blocks are connected when they share an edge; touching at a single corner does not count. Islands and other detached land are joined to the nearest block of the main body, so a state with islands can still be cut.'),
    ),
    section(
      'recursion',
      4,
      p('Each side of a cut is cut again in the same way, and so on, until every piece has exactly one seat. Each piece then becomes one district.'),
      p('A state with N seats takes exactly N minus 1 cuts. Each piece is cut on its own, so the order in which pieces are handled does not change the result.'),
      figure('Seven seats take six cuts: 3 and 4, then each side again, until every piece has one seat.', recursionDiagram()),
    ),
    section(
      'balancing',
      5,
      p('U.S. House districts must be as nearly equal in population as practicable. That is the standard the Supreme Court applied to congressional districts in Karcher v. Daggett (1983). Each cut comes as close to equal as whole blocks allow, but the small differences, and the stray pieces, add up across many cuts. So after the last cut a balancing pass evens out the populations, one block at a time.'),
      h(
        'ol',
        { class: 'strv-how__steps' },
        li('Start with the district whose population is furthest from the ideal.'),
        li('Look at the blocks along its border. A block may move to the district on the other side only if it has people, if the move strictly narrows the population gap between the two districts, and if both districts stay one connected piece.'),
        li('Of the moves allowed, make the one that brings the districts closest to equal overall, measured as the sum of the squared differences between each district’s population and the ideal. A tie goes to the block that comes first in GEOID order, then to the lower-numbered district it would join.'),
        li('If that district has no allowed move, try the next furthest. After every move, start again from the district now furthest from the ideal.'),
        li('Stop when no move helps. Every move brings the districts closer to equal overall, so the pass always stops.'),
      ),
      figure('A block may move only if the gap between the two districts gets strictly smaller. Example numbers.', balanceDiagram()),
      h('h3', { class: 'strv-how__h3' }, 'In the real states'),
      balanceSentence,
      balanceTable,
    ),
    section(
      'fingerprint',
      6,
      p('There are no random numbers and no seed, and nobody chooses a starting point or a preferred outcome. Blocks are always processed in GEOID order. Given the same census files, the same angle step and the same Node.js major version (the maps here were made with Node.js 24), the generator writes a byte-identical assignment file and identical district shapes.'),
      p('The map itself is a file that lists every block and the district it belongs to. Its SHA-256 hash is the map’s fingerprint: 64 characters that change completely if even one block is assigned differently. Two people can compare that one value to confirm they got the same map. Each state’s fingerprint is printed under “Check this map” in its view.'),
      figure('The same inputs always give the same assignment file, and so the same fingerprint.', fingerprintDiagram()),
      h('h3', { class: 'strv-how__h3' }, 'To reproduce a state’s map'),
      h('pre', { class: 'strv-code', tabindex: 0, role: 'group', 'aria-label': 'Commands to run' }, h('code', null, 'npm install\nnpm run explore -- --states CO')),
      p('The state is given by its two-letter abbreviation. The census block file for the state is downloaded from the U.S. Census Bureau the first time it is needed.'),
    ),
    section(
      'sources',
      7,
      h(
        'ul',
        { class: 'strv-how__list' },
        li(h('strong', null, '2020 Census blocks'), ', from the U.S. Census Bureau: people, shapes and internal points. The only data that draws the maps.'),
        li(h('strong', null, '119th Congress districts'), ', from the Census Bureau’s cartographic boundary file ', code('cb_2025_us_cd119_500k'), '. Shown for comparison only and never read by the generator. A state that adopted a new map after that file was made is not reflected in it.'),
        li(h('strong', null, 'State outlines and county names'), ', from the Census Bureau’s cartographic boundary files. Used for display and for counting the counties a district touches.'),
        li(h('strong', null, 'Address search'), ' uses the U.S. Census Bureau geocoder. The address you type is sent to that service.'),
      ),
      figure('Only the census blocks draw the map. Everything else is display.', sourcesDiagram()),
      h('h3', { class: 'strv-how__h3' }, 'Limits'),
      h(
        'ul',
        { class: 'strv-how__list' },
        li('District shapes are simplified so the maps load quickly. They are slightly coarser than the block-level shapes. The numbers, and the file that assigns every block to a district, are never simplified.'),
        li('Because the shapes are simplified, an address very close to a border may show in the wrong district. Close to a border, the block assignment file is the final word.'),
      ),
    ),
  );

  const el = h(
    'main',
    { class: 'strv-how', id: 'strv-main' },
    h(
      'header',
      { class: 'strv-how__head' },
      h('a', { href: formatHash(NATIONAL), class: 'strv-back' }, iconArrowLeft(), 'All states'),
      h1,
      h('p', { class: 'strv-how__lede' }, 'Every map in this viewer comes from 2020 Census counts and one fixed rule. Here is each stage in plain language, with a drawing. Numbers in the drawings are examples unless they name a state.'),
    ),
    // The wrapper measures the room: the stage list sits beside the text only when the text keeps a readable measure.
    h('div', { class: 'strv-how__room' }, h('div', { class: 'strv-how__grid' }, toc, body)),
  );

  function scrollTo(section: HowSection | null, focus: boolean): void {
    if (!section) return;
    const target = el.querySelector<HTMLElement>(`#${sectionId(section)}-h`);
    if (!target) return;
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
      if (focus) target.focus({ preventScroll: true });
    });
  }

  function markToc(section: HowSection | null): void {
    for (const a of toc.querySelectorAll<HTMLAnchorElement>('a[data-section]')) {
      if (a.dataset.section === section) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    }
  }

  async function loadNumbers(): Promise<void> {
    try {
      const index = await loadIndex();
      const states = byName(index).filter(isGenerated);
      const stats = await Promise.all(states.map((s) => loadStats(s.abbr)));
      if (!alive) return;
      const rows = states.map((s, i) => ({ abbr: s.abbr, name: s.name, m: stats[i]!.finished.metrics }));
      const lead = rows.find((r) => r.abbr === 'CO') ?? rows[0];
      clear(balanceSentence);
      if (lead) {
        const m = lead.m;
        balanceSentence.append(
          `In ${lead.name}, ${formatInt(m.balanceMoves)} ${m.balanceMoves === 1 ? 'move' : 'moves'} shifted ${formatInt(m.peopleMovedByBalancing)} ${m.peopleMovedByBalancing === 1 ? 'person' : 'people'} and cut the range between the largest and smallest district from `,
          `${formatInt(m.rangeBeforeBalancing)} to ${formatInt(m.rangeAfterBalancing)} ${m.rangeAfterBalancing === 1 ? 'person' : 'people'}.`,
        );
        balanceSentence.after(h('p', { class: 'strv-how__watch' }, h('a', { href: formatHash(stateRoute(lead.abbr, { move: 0 })) }, `Watch the balancing in ${lead.name}`)));
      }
      clear(balanceTable);
      balanceTable.append(balancingTable(rows));
    } catch (err) {
      if (!alive) return;
      clear(balanceSentence);
      balanceSentence.append(describeError(err), ' ');
      balanceSentence.append(h('button', { type: 'button', class: 'strv-button', onclick: () => void loadNumbers() }, 'Try again'));
    }
  }

  void loadNumbers();
  document.title = 'How the districts are drawn';
  markToc(initial.section);
  scrollTo(initial.section, false);

  return {
    el,
    focusTarget: () => (initial.section ? el.querySelector<HTMLElement>(`#${sectionId(initial.section)}-h`) : h1),
    update(next) {
      if (next.page !== 'how') return false;
      markToc(next.section);
      if (next.section) scrollTo(next.section, true);
      else {
        window.scrollTo(0, 0);
        h1.focus({ preventScroll: true });
      }
      return true;
    },
    destroy() {
      alive = false;
    },
  };
}
