import {
  h,
  clear,
  config,
  CHANGELOG,
  ENACTED,
  ordinal,
  dataUrl,
  describeError,
  fetchJson,
  formatHash,
  formatInt,
  faqRoute,
  howRoute,
  iconArrowLeft,
  iconChevronDown,
  prefersReducedMotion,
  reproduceCommands,
  stateRoute,
  NATIONAL,
  HOW_SECTIONS,
  type HowSection,
  type Page,
  type Route,
} from '../../shared';
import { loadIndex, isGenerated, byName } from '../../entities/state';
import { ruleSlot, wireExact, destroyExact } from './demo-slots';
import { loadStats, cutRows, CutsSchema, type CutRow, type Metrics } from '../../entities/plan';
import {
  inputsDiagram,
  fanDiagram,
  borderDiagram,
  recountDiagrams,
  strandedDiagrams,
  recursionDiagram,
  balanceDiagrams,
  balanceChoiceDiagram,
  directionsDiagram,
  rangesDiagram,
  signed,
  fingerprintDiagram,
  sourcesDiagram,
} from './diagrams';
import { BALANCE_EXAMPLE, DIRECTION_EXAMPLE, SPLIT_EXAMPLE, STRANDED_EXAMPLE, applyTrade, bestTrade, furthest, improvement, recountExample, sumOfSquares, walkSplit } from './examples';

const TITLES: Record<HowSection, string> = {
  inputs: 'What goes in',
  cut: 'One cut',
  strays: 'Stray pieces and the re-count',
  recursion: 'Repeat until every piece has one seat',
  balancing: 'Balancing, and why it is needed',
  fingerprint: 'Same data, same map',
  sources: 'Data sources and limits',
};

const sectionId = (s: HowSection): string => `strv-how-${s}`;

const p = (...children: (Node | string)[]): HTMLElement => h('p', null, ...children);
const li = (...children: (Node | string)[]): HTMLElement => h('li', null, ...children);
/** Exact detail, folded away: the plain summary above it stands on its own. */
function exact(...body: (Node | string)[]): HTMLElement {
  const details = h(
    'details',
    { class: 'strv-how__more' },
    h('summary', { class: 'strv-how__more-summary' }, iconChevronDown(), h('span', null, 'The exact rule')),
    h('div', { class: 'strv-how__more-body' }, body),
  );
  wireExact(details);
  return details;
}

/** Every case id wired into an expander under `root`, in page order. */
export function exactCaseIds(root: ParentNode): string[] {
  return [...root.querySelectorAll<HTMLElement>('[data-case]')].map((el) => el.dataset.case ?? '');
}

/** A list item of an exact rule with a place after its text for the case's animated panel (none when `caseId` is null). */
export function exactItem(caseId: string | null, ...children: (Node | string)[]): HTMLElement {
  if (caseId === null) return li(...children);
  return li(...children, ruleSlot(caseId));
}

/** A paragraph of an exact rule followed by a sibling slot for the case's panel. */
function exactPara(caseId: string, ...children: (Node | string)[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  frag.append(p(...children), ruleSlot(caseId));
  return frag;
}

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
          h('th', { scope: 'col', class: 'strv-how__num strv-how__col-opt' }, 'People moved'),
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
            num(formatInt(r.m.peopleMovedByBalancing), { class: 'strv-how__num strv-how__col-opt' }),
            num(formatInt(r.m.rangeBeforeBalancing)),
            num(formatInt(r.m.rangeAfterBalancing)),
          ),
        ),
      ),
    ),
  );
}

const num = (v: string, attrs: Record<string, string> = {}): HTMLElement => h('td', { class: 'strv-how__num', ...attrs }, v);
const colHead = (label: string, isNum = true): HTMLElement => h('th', { scope: 'col', class: isNum ? 'strv-how__num' : null }, label);

/** One real state's cuts, in order, each opening the live map at that cut. */
function followCutsTable(rows: readonly CutRow[]): HTMLElement {
  return h(
    'div',
    { class: 'strv-list-scroll strv-how__table-wrap strv-how__table-wrap--narrow' },
    h(
      'table',
      { class: 'strv-how__table' },
      h('caption', { class: 'strv-list__caption' }, 'Colorado, cut by cut. Seats: the seats in the piece being cut. Border: the length of the real border the cut made.'),
      h('thead', null, h('tr', null, colHead('Cut', false), colHead('Seats'), colHead('Split'), colHead('Border'))),
      h(
        'tbody',
        null,
        rows.map((r) =>
          h(
            'tr',
            null,
            h('th', { scope: 'row' }, h('a', { href: formatHash(stateRoute('CO', { cut: r.order })), 'aria-label': `Cut ${r.order}: open Colorado’s map at this cut` }, `Cut ${r.order}`)),
            num(formatInt(r.seats)),
            num(r.split.replace(' + ', ' and ')),
            num(r.border),
          ),
        ),
      ),
    ),
  );
}

/** The cut example: blocks in order, a running total, and where the first side stops. */
function splitTable(): HTMLElement {
  const { blocks, seats, lowSeats } = SPLIT_EXAMPLE;
  const walk = walkSplit(blocks.map((b) => b.people), seats, lowSeats);
  return h(
    'div',
    { class: 'strv-list-scroll strv-how__table-wrap strv-how__table-wrap--narrow' },
    h(
      'table',
      { class: 'strv-how__table strv-how__table--walk' },
      h('caption', { class: 'strv-list__caption' }, `Blocks in order across the line. The first side’s share is ${formatInt(walk.share)} people. Example numbers.`),
      h('thead', null, h('tr', null, colHead('Block', false), colHead('People'), colHead('Running total'))),
      h(
        'tbody',
        null,
        blocks.map((b, i) => {
          const crossing = i === walk.crossing;
          const last = i === walk.count - 1;
          return h(
            'tr',
            { 'data-crossing': crossing ? 'true' : null, 'data-split': last ? 'true' : null },
            h('th', { scope: 'row' }, b.name, crossing ? h('span', { class: 'strv-how__flag' }, 'passes the share') : null),
            num(formatInt(b.people)),
            num(formatInt(walk.running[i]!)),
          );
        }),
      ),
    ),
  );
}

/** The balancing example: every trade from the furthest district, scored. */
function tradesTable(): HTMLElement {
  const { start, trades } = BALANCE_EXAMPLE;
  const best = bestTrade(start, trades);
  const districts = Object.keys(start).map(Number).sort((a, b) => a - b);
  const row = (label: Node | string, dev: Record<number, number>, better: string, chosen = false): HTMLElement =>
    h(
      'tr',
      { 'data-chosen': chosen ? 'true' : null },
      h('th', { scope: 'row' }, label),
      districts.map((d) => num(signed(dev[d] ?? 0), { 'data-label': `District ${d}` })),
      num(formatInt(sumOfSquares(dev)), { 'data-label': 'Sum of squares' }),
      num(better, { 'data-label': 'Better by' }),
    );
  return h(
    'div',
    { class: 'strv-list-scroll strv-how__table-wrap strv-how__table-wrap--trades', tabindex: 0, role: 'group', 'aria-label': 'Each trade and its score' },
    h(
      'table',
      { class: 'strv-how__table strv-how__table--trades' },
      h('caption', { class: 'strv-list__caption' }, 'People above (+) or below (−) an even split after each trade, and the sum of their squares. Example numbers.'),
      h('thead', null, h('tr', null, colHead('Trade', false), districts.map((d) => colHead(`District ${d}`)), colHead('Sum of squares'), colHead('Better by'))),
      h(
        'tbody',
        null,
        row('Before any trade', start, '–'),
        trades.map((t) =>
          row(
            h('span', null, `${t.id}: ${formatInt(t.people)} people to District ${t.to}`, t === best ? h('span', { class: 'strv-how__flag' }, 'chosen') : null),
            applyTrade(start, t),
            formatInt(improvement(start, t)),
            t === best,
          ),
        ),
      ),
    ),
  );
}

/**
 * How it works: every stage of the method in plain language, each with a
 * drawing. It says what docs/explanation/how-districts-are-drawn.md says and
 * nothing the generator does not do.
 */
export function createHowPage(initial: Extract<Route, { page: 'how' }>): Page {
  let alive = true;
  const h1 = h('h1', { class: 'strv-how__h1', tabindex: -1 }, 'How the districts are drawn');

  // The balancing figures come from every state's own numbers; they arrive after the page.
  // Unpinned until the published data says which maps release Colorado belongs to; the bundled release is the site's, not the data's.
  const recipeCode = h('code', null, reproduceCommands('CO', null));
  const balanceSentence = h('p', { class: 'strv-how__real' }, 'Loading the numbers for each state…');
  const balanceTable = h('div', { class: 'strv-how__real-table' });
  // Colorado's own cuts, for following one state through the repeat.
  const followSentence = h('p', { class: 'strv-how__real' }, 'Loading Colorado’s cuts…');
  const followTable = h('div', { class: 'strv-how__real-table' });

  // The worked examples' figures, all derived from the example data.
  const splitBlocks = SPLIT_EXAMPLE.blocks;
  const splitWalk = walkSplit(splitBlocks.map((b) => b.people), SPLIT_EXAMPLE.seats, SPLIT_EXAMPLE.lowSeats);
  const splitCrossing = splitBlocks[splitWalk.crossing]!.name;
  const dirShortest = [...DIRECTION_EXAMPLE].sort((a, b) => a.km - b.km)[0]!;
  const exStart = BALANCE_EXAMPLE.start;
  const exD = furthest(exStart);
  const exBest = bestTrade(exStart, BALANCE_EXAMPLE.trades);
  const exAfter = applyTrade(exStart, exBest);
  const recount = recountExample();

  const toc = h(
    'nav',
    { class: 'strv-how__toc', 'aria-labelledby': 'strv-how-toc-h' },
    h(
      'div',
      { class: 'strv-how__toc-inner' },
      h('h2', { id: 'strv-how-toc-h', class: 'strv-how__toc-h' }, 'On this page'),
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
      h(
        'div',
        { class: 'strv-how__ledger' },
        h('p', { class: 'strv-how__ledger-lead' }, 'Three facts about each census block go in, plus each state’s seat count. Nothing else does.'),
        h(
          'div',
          { class: 'strv-how__ledger-col strv-how__ledger-col--in' },
          h('h3', { class: 'strv-how__ledger-h' }, 'Goes in'),
          h(
            'ul',
            { class: 'strv-how__ledger-list' },
            li('how many people the census counted there'),
            li('where its edges are'),
            li('one point inside it, used to put blocks in order and to measure island links'),
          ),
          h('p', { class: 'strv-how__ledger-note' }, 'Plus one number per state: its House seats from the 2020 apportionment.'),
        ),
        h(
          'div',
          { class: 'strv-how__ledger-col strv-how__ledger-col--out' },
          h('h3', { class: 'strv-how__ledger-h' }, 'Never goes in'),
          h(
            'ul',
            { class: 'strv-how__ledger-list' },
            li('party registration or voter records'),
            li('election results or turnout'),
            li('where officeholders or candidates live'),
            li('current or past district lines'),
            li('race, ethnicity, age, income or anything else about people besides the count'),
            li('county and city lines'),
          ),
        ),
      ),
      p('The generator works from the 2020 Census, one census block at a time. A census block is the smallest area the Census Bureau counts people in: an area bounded by features such as streets, streams and railroad tracks, or by lines such as city and property limits. Every person in the country is counted in exactly one block. For every block in a state it reads three things:'),
      h(
        'ul',
        { class: 'strv-how__list' },
        li('the number of people counted in the block,'),
        li('the block’s shape on the ground, and'),
        li('the block’s internal point, a point inside the block that the Census Bureau publishes (', code('INTPTLAT20'), ' and ', code('INTPTLON20'), '). It is used to put blocks in order across a guide line and to measure island links.'),
      ),
      figure('Each block brings its shape, its count of people and its internal point. Example numbers.', inputsDiagram()),
      p('Current district lines are shown on the map for comparison only. The generator never reads them. County and city boundaries are not used to draw anything. Counties are only counted afterwards, for reporting. People are counted where the census counted them, with no adjustments, so a person in a prison is counted at the prison.'),
      p('The number of districts for each state is the number of House seats the state received in the 2020 apportionment.'),
    ),
    section(
      'cut',
      2,
      p('Each cut splits a piece of the state in two. The line is placed so that each side holds its share of the seats and of the people, and each side must be one connected piece. Of all the straight lines that do both, the one with the shortest border is used.'),
      p('Start with the whole state. A piece with some number of seats is split into two sides that hold as close to half the seats each as possible: a piece with 7 seats is split 3 and 4, a piece with 2 seats is split 1 and 1.'),
      p('To find the line, the generator considers a straight guide line in every direction. Each line is placed so the people on one side match that side’s share of the seats.'),
      figure('Every direction is considered. Twelve example lines are drawn here.', fanDiagram()),
      h('h3', { class: 'strv-how__h3' }, 'Every straight line, checked once'),
      p('There are endlessly many directions, but the split can change only at certain angles: the ones where the line runs parallel to the segment between two blocks’ internal points. Between two such angles every direction gives the same two sides. The generator finds those angles, then checks each stretch between them once. That covers every direction, with none skipped.'),
      figure('Directions from 0° to 180°, cut at the angles where the split changes. Each stretch is checked once. Example numbers.', rangesDiagram()),
      h('h3', { class: 'strv-how__h3' }, 'Blocks stay whole'),
      p('A census block is never split: the census counts people only per block, so there is no count for part of a block. Each block goes, whole, to the side its internal point is on. So the guide line only decides which side each block joins, and the real border follows block edges.'),
      figure('Each block goes, whole, to the side its internal point is on. The real border follows block edges.', borderDiagram()),
      h('h3', { class: 'strv-how__h3' }, 'The shortest border wins'),
      p('Every guide line becomes a real border, and the generator measures its length. First, any stray pieces join the side around them and the line slides so the people still split evenly (the next stage). Then each side must be one connected piece. Of the lines that pass, the one with the shortest real border is used.'),
      h('h3', { class: 'strv-how__h3' }, 'How the winning line is chosen'),
      h(
        'ol',
        { class: 'strv-how__steps' },
        li(h('strong', null, 'Put the blocks in order.'), ' Take one direction. Line up the piece’s blocks by where their internal points sit across a line in that direction, from one edge of the piece to the other.'),
        li(h('strong', null, 'Walk until the first side has its share.'), ' Go along that order adding up people. Find the block that takes the running total to the first side’s share or past it. Stop just before that block or just after it, whichever leaves the total closer to the share. If both are exactly equally close, both stopping points are kept as candidates, and the tie rules below choose between them.'),
        li(h('strong', null, 'Settle the stray pieces.'), ' Pieces cut off from their side join the side around them, and the line slides so the people still split evenly (the next stage).'),
        li(h('strong', null, 'Repeat for every stretch of directions.'), ' Do the same for each stretch between the angles where the split changes, so every straight line is covered.'),
        li(h('strong', null, 'Measure the real borders.'), ' For each stretch, measure the border along block edges that it makes.'),
        li(h('strong', null, 'The shortest border wins.'), ' The shortest border whose two sides are each one connected piece is used. If two different cuts have exactly the same border length, the one whose sides are nearer their fair shares of people wins, and then GEOID decides (see the exact rules below).'),
      ),
      h(
        'div',
        { class: 'strv-how__worked' },
        h('h3', { class: 'strv-how__h3' }, 'A worked example: placing one line'),
        p(`Example numbers: a piece with 2 seats and ${formatInt(splitWalk.total)} people, so the first side’s share is half, ${formatInt(splitWalk.share)} people. For one direction, its eight blocks are already in order across the line.`),
      ),
      splitTable(),
      p(
        `The running total passes ${formatInt(splitWalk.share)} at block ${splitCrossing}. Stopping just before ${splitCrossing} leaves ${formatInt(splitWalk.before)} people, ${formatInt(splitWalk.share - splitWalk.before)} short. Stopping just after it gives ${formatInt(splitWalk.after)}, ${formatInt(splitWalk.after - splitWalk.share)} over. ${formatInt(splitWalk.after - splitWalk.share)} is closer, so the walk stops after ${splitCrossing}: blocks ${splitBlocks[0]!.name} to ${splitCrossing} (${formatInt(splitWalk.after)} people) form one side, and ${splitBlocks[splitWalk.count]!.name} to ${splitBlocks[splitBlocks.length - 1]!.name} (${formatInt(splitWalk.total - splitWalk.after)} people) the other. Had both been exactly equally close, both stopping points would have been kept as candidates, and the tie rules would have chosen between them.`,
      ),
      h('h3', { class: 'strv-how__h3' }, 'Comparing directions'),
      p('That walk places one line. It is repeated for every stretch of directions, and each gets its real border measured. The drawing shows three of them.'),
      figure(`The same piece split in three directions. The border at ${dirShortest.angle}° is the shortest of the three, ${dirShortest.km} km. Example numbers.`, directionsDiagram()),
      exact(
        h(
          'ul',
          { class: 'strv-how__list' },
          exactItem('cut.both-ways', h('strong', null, 'Both ways of splitting the seats.'), ' When the two shares differ (an odd number of seats), the whole half turn is swept twice, once with the smaller share on each side of the line, and each sweep has its own stretches.'),
          exactItem('cut.globe', h('strong', null, 'Straight on a globe.'), ' A straight line here is a great circle, the path a plane through the center of the Earth traces on its surface. The directions are measured in a flat projection centered on the state, in which every great circle is a straight line.'),
          exactItem('cut.order', h('strong', null, 'Putting blocks in order.'), ' The blocks are ordered by how far their internal points sit across the line. The generator walks along that order, adding up people, until the first side holds as close to its share as whole blocks allow. Two blocks sit at exactly the same distance only at the one direction where they swap places, and every stretch is checked between such directions. Blocks whose internal points coincide are taken in GEOID order, the census block identifier, so the order is always the same.'),
          exactItem('cut.measure', h('strong', null, 'Measuring the border.'), ' The length is the total of the block edges with one side on each hand, measured along the surface of the Earth. The census gives each block’s outline as corner points in longitude and latitude, not lengths, so each straight stretch between two corner points is measured as the shortest path over a sphere the size of the Earth (radius 6,371,008.8 m). The stretches two blocks share are added into one length for that pair, stored as a whole number of micrometers, and the border is the sum over every pair split by the line. Whole numbers add up exactly in any order, so the same border always gets exactly the same length. The census gives block outlines to about 11 cm (six decimal places of a degree). Lengths are kept in whole micrometers only so that adding them up always gives exactly the same total; that unit is far finer than the outlines themselves. Water inside the state counts as part of the state, so a bay or a lake does not shorten or break a border.'),
          exactItem('cut.share', h('strong', null, 'The share.'), ' The first side’s share is the piece’s population times the first side’s seats, divided by the piece’s seats. It need not be a whole number: 3 seats split 1 and 2 with 1,000 people make a share of 333⅓.'),
          exactItem('cut.walk-stop', h('strong', null, 'Where the walk stops.'), ' The walk stops at the first block that brings the running total to the share or past it. If the total after that block is strictly closer to the share than the total before it, the block joins the first side. If the total before it is strictly closer, the block starts the second side. If the two are exactly equally close, or an empty block sits next to a side that is exactly on its share, walking the order from one end and walking it from the other end can stop in different places. Both are kept as candidates, and the tie rules below choose between them. The generator walks from the other end only where such a tie happens. Each side always keeps at least one block.'),
          exactItem('cut.order-of-checks', h('strong', null, 'The order of the checks.'), ' Every stretch’s line is first settled for stray pieces, with its re-counts (the next stage), and its real border is measured after that. The borders are compared by length, and the shortest whose two sides are each one connected piece is used.'),
          exactItem('cut.ties', h('strong', null, 'Ties.'), ' Lengths are compared exactly as stored, so any shorter border wins, and two borders are tied only when their stored lengths are exactly equal. Usually that means two stretches that give the same two sides, which are one cut, so nothing is decided. If two different cuts ever had exactly equal borders, two rules would decide in turn. First, the cut whose first side holds a number of people nearer its fair share is used (the piece’s people times the first side’s seats, divided by the piece’s seats; the distance is the same measured from the second side). If that is exactly equal too, GEOID decides: take the block with the lowest GEOID in the piece, find the lowest GEOID among the blocks the two cuts put on different sides, and use the cut that puts that block on the same side as the piece’s lowest GEOID. Exact ties between different cuts are rare on real census lengths. The line drawn on the map is the middle of the first stretch giving the chosen cut, going clockwise from north. That is a choice about where to draw the line, not a rule for choosing the cut.'),
        ),
      ),
    ),
    section(
      'strays',
      3,
      p('Because blocks stay whole, a large block that straddles the guide line can leave a smaller block cut off from the rest of its side. A block, or a group of blocks, cut off like this is a stray piece.'),
      p('A stray piece joins the side around it and stays there for the rest of that cut. Then the people are counted again, including the pieces that moved, and the line slides so the two sides still hold their shares. If the slide cuts off a new piece, that piece joins the side around it too, and the count is done again. This repeats until nothing is cut off.'),
      h(
        'div',
        { class: 'strv-how__worked' },
        h('h3', { class: 'strv-how__h3' }, 'A worked example: one re-count'),
        p(`Example numbers: a piece with 2 seats and ${formatInt(recount.low + recount.high)} people, so each side’s share is ${formatInt(recount.share)}.`),
      ),
      figure(
        `The re-count in three steps: the small block inside the large one is cut off as a stray piece, joins the side around it, and the line slides so each side still holds ${formatInt(recount.low)} people. Example numbers.`,
        ...recountDiagrams(),
      ),
      h('h3', { class: 'strv-how__h3' }, 'Big stray pieces are allowed'),
      p(`There is no limit on how many people a stray piece holds. A line that cuts off a big region still has to win on border length, like every other line, and its border is measured after the strays have joined and the line has slid. Here the line across both arms cuts off ${formatInt(STRANDED_EXAMPLE.stranded.people)} people and is allowed, but its border, ${STRANDED_EXAMPLE.stranded.km} km, is longer than the ${STRANDED_EXAMPLE.clean.km} km of a line that cuts off nobody. The stray piece itself adds no border; the extra length comes from the slid line crossing the wide right arm.`),
      figure(`Left: a line that cuts off ${formatInt(STRANDED_EXAMPLE.stranded.people)} people; the line slides down the right arm and its real border is ${STRANDED_EXAMPLE.stranded.km} km. Right: a line that cuts off nobody, with a ${STRANDED_EXAMPLE.clean.km} km border. The shorter border is used. Example numbers.`, ...strandedDiagrams()),
      p('A cut is also used only if both of its sides are each one connected piece.'),
      exact(
        h(
          'ul',
          { class: 'strv-how__list' },
          exactItem('strays.which-stays', h('strong', null, 'Which group stays.'), ' On each side, every connected group of blocks other than the side’s main body joins the other side, the side around it. The main body is the group with the most people; if two groups have exactly as many, the one holding the lower GEOID. Each round settles first the side that holds the piece’s lowest GEOID, then the other side, and this repeats until nothing moves.'),
          exactItem('strays.fixed', h('strong', null, 'Moved pieces are fixed.'), ' A block that moves is fixed to its new side at once. It never moves again during that cut: not in a later pass, and not after a re-count. Fixed blocks count toward their side’s groups like any other block. If a group cut off from its side’s main body contains fixed blocks, its free blocks still join the other side, and its fixed blocks stay where they are.'),
          exactItem('strays.recount', h('strong', null, 'The re-count.'), ' The walk from stage 2 is done again over the free blocks only, in the same order. The fixed blocks’ people already count on their sides, so the first side’s target is its share minus the people fixed on it. The stopping rule is the same: the closer total, with both stopping points kept as candidates when they are exactly equally close. A side with no fixed blocks keeps at least one free block. The line is placed between the last free block of the first side and the first free block of the second.'),
          exactItem('strays.ends', h('strong', null, 'When it ends.'), ' Stray pieces are settled and the people re-counted until a pass moves no free block. Every re-count follows at least one newly fixed block, and fixed blocks never become free, so a piece of n blocks needs at most n walks.'),
          exactItem('strays.no-rejoin', h('strong', null, 'A piece that cannot rejoin.'), ' If a pass moves nothing but a fixed piece is still cut off from its side, it cannot move back. That line’s sides are not each one connected piece, so it fails the check that each side is one connected piece, and the next shortest line is considered.'),
          exactItem('strays.outline', h('strong', null, 'Crossing the outline.'), ' A line may cross the piece’s outline any number of times.'),
          exactItem('strays.connected', h('strong', null, 'Connected.'), ' Two blocks are connected when they share an edge; touching at a single corner does not count. Census blocks cover lakes, bays and coastal water, and a water block is a block like any other. Land on two shores is therefore connected when blocks of the same district, water blocks included, join them.'),
          exactItem('strays.islands', h('strong', null, 'Islands.'), ' Land that no block reaches, even across water, is connected the way cuts are chosen: of every possible link from the connected land to a detached piece, measured between internal points, the shortest is added, and this repeats until every piece is connected. If two links are exactly the same length, the one between the blocks that come first in GEOID order is added. A link often goes to another island rather than the mainland, so a state with islands can still be cut. The map draws these links as dashed lines. Keep in mind that a link joins pieces, not single islands: the Census Bureau sometimes draws one block around a cluster of small islands, and those islands are already one block, so no link is drawn between them. To see this, click a district to select it and zoom in. Zoomed in, the map is drawn block by block, and the selected district’s links stay on screen as dashed lines.'),
        ),
      ),
    ),
    section(
      'recursion',
      4,
      p('Each side of a cut is cut again in the same way, and so on, until every piece has exactly one seat. Each piece then becomes one district.'),
      p('A state with N seats takes exactly N minus 1 cuts. Each piece is cut on its own, so the order in which pieces are handled does not change the result.'),
      figure('Seven seats take six cuts: 3 and 4, then each side again, until every piece has one seat.', recursionDiagram()),
      h('h3', { class: 'strv-how__h3' }, 'Following one state: Colorado'),
      followSentence,
      followTable,
    ),
    section(
      'balancing',
      5,
      p('U.S. House districts must be as nearly equal in population as practicable. That is the standard the Supreme Court applied to congressional districts in Karcher v. Daggett (1983). Each cut stops at the block that brings its sides closest to their shares, but whole blocks rarely land exactly on a share, and the small differences add up across many cuts.'),
      p('So after the cuts, the districts are close to equal but not exactly. To finish the job, districts trade single blocks along their shared borders, one at a time. A trade is only made if it brings the two districts closer to equal and keeps both in one piece. When no trade helps any more, it stops.'),
      figure('Gap: the difference between the two districts’ populations. A block may move only if that gap gets strictly smaller. Example numbers.', ...balanceDiagrams()),
      h('h3', { class: 'strv-how__h3' }, 'How the next block is chosen'),
      h(
        'ol',
        { class: 'strv-how__steps' },
        li(h('strong', null, 'Find the district furthest from the ideal.'), ' Distance is counted from the ideal population, so 400 people over and 400 people under are equally far. If two districts are equally far, the one whose first block comes first in GEOID order goes first.'),
        li(h('strong', null, 'List every single-block trade involving it.'), ' That means each of its own blocks that touches a neighboring district, moving out to that neighbor, and each neighbor’s block that touches it, moving in. A trade is allowed only if it strictly narrows the population gap between the two districts, so a block with no people never moves.'),
        li(h('strong', null, 'Score each trade.'), ' The score is how much the trade brings the whole state closer to even, measured as the sum of squared distances from the ideal: square each district’s distance and add them up. Squaring makes a big miss count far more than a small one. One district 400 off adds 160,000; four districts 100 off add only 40,000 between them. A trade that does not strictly lower the sum is dropped.'),
        li(h('strong', null, 'Take the best trade that keeps the giving district in one piece.'), ' If two trades score the same, the one that leaves the shorter total border wins, then the block that comes first in GEOID order.'),
        li(h('strong', null, 'Start over.'), ' Go back to step 1 with the new populations. If the furthest district has no trade allowed, try the next furthest.'),
        li(h('strong', null, 'Stop when no trade helps anywhere.')),
      ),
      h(
        'div',
        { class: 'strv-how__worked' },
        h('h3', { class: 'strv-how__h3' }, 'A worked example: one move'),
        p(
          `Example numbers: District ${exD} is ${formatInt(exStart[exD]!)} people above an even split, District 1 is ${formatInt(-exStart[1]!)} below and District 5 is ${formatInt(-exStart[5]!)} below. Every other district is already even. The sum of squares is ${formatInt(exStart[exD]!)}² + ${formatInt(-exStart[1]!)}² + ${formatInt(-exStart[5]!)}² = ${formatInt(sumOfSquares(exStart))}.`,
        ),
        p(`District ${exD} is furthest off, so its trades are listed. Moving any block into District ${exD} would push it further over, so those trades make the sum bigger and are dropped. Three trades are left.`),
      ),
      figure(`Three blocks on District ${exD}’s border could move. The amber one leaves the state closest to even. Example numbers.`, balanceChoiceDiagram()),
      tradesTable(),
      p(
        `Trade ${exBest.id} wins: it leaves the state closest to even overall, a sum of ${formatInt(sumOfSquares(exAfter))}. Trade A also helps a lot, but leaves District ${exD} ${formatInt(applyTrade(exStart, BALANCE_EXAMPLE.trades[0]!)[exD]!)} over. Trade C leaves District 1 ${formatInt(-exStart[1]!)} short.`,
      ),
      p(
        `Then the process starts over from whichever district is now furthest off. After trade ${exBest.id}, District ${exD} is ${formatInt(exAfter[exD]!)} over and District 5 is ${formatInt(-exAfter[5]!)} under. They are equally far, so the tie goes to the district whose first block comes first in GEOID order, and the next round starts from District ${furthest(exAfter)}.`,
      ),
      p('In the replay, each move is one of these choices; the readout shows the block, its people, and the two districts’ new gap.'),
      exact(
        exactPara('balance.ideal', 'The pass makes one move at a time. The ideal is the state’s population divided by its number of seats. People come whole, so an even split puts each district at the ideal rounded down or up. For example, Missouri’s 6,154,913 people and 8 seats make an ideal of 769,364.125, so an even split is 769,364 or 769,365 people. The viewer shows how far each district is from an even split, in whole people.'),
        h(
          'ol',
          { class: 'strv-how__steps' },
          exactItem('balance.furthest', 'Start with the district whose population is furthest from the ideal, measured as the absolute difference. A tie goes to the district whose first block comes first in GEOID order.'),
          exactItem('balance.allowed', 'Look at the blocks along its border: its own blocks that touch a neighboring district, and the neighbors’ blocks that touch it. A block may move to the district on the other side only if the move strictly narrows the gap between the two districts (so a block with no people never moves) and the district it leaves stays one connected piece. The district it joins stays connected too, because the block touches it.'),
          exactItem('balance.score', 'Of the moves allowed, make the one that brings the districts closest to equal overall, measured as the sum of the squared differences between each district’s population and the ideal. Only the two districts in a move change, so moving p people from a district a people above the ideal to one b people above it (a negative number when below) lowers the sum by exactly 2 × p × (a − b − p). That is above zero exactly when the gap between the two narrows. A tie goes to the trade that leaves the shorter total border: the length the block shares with the district it leaves minus the length it shares with the district it joins, compared exactly, each sum added in the block’s fixed neighbor order. A further tie goes to the block that comes first in GEOID order, then to the receiving district whose first block comes first in GEOID order. A move that would leave the giving district with no blocks is never made.'),
          exactItem('balance.next-furthest', 'If that district has no allowed move, try the next furthest. After every move, start again from the district now furthest from the ideal.'),
          exactItem('balance.stop', 'Stop when no move helps. Every move lowers the sum of the squared differences, so the pass always stops.'),
        ),
      ),
      h('h3', { class: 'strv-how__h3' }, 'In the real states'),
      balanceSentence,
      balanceTable,
    ),
    section(
      'fingerprint',
      6,
      p('Run the generator again on the same data and you get the same map, down to the last block. There are no random numbers and no seed, and nobody chooses a starting point or a preferred outcome.'),
      p('The map itself is a file that lists every block and the district it belongs to. Its fingerprint is a 64-character code worked out from that file. The code changes completely if even one block is assigned differently, so two people can compare that one value to confirm they got the same map. Each state’s fingerprint is printed under “Check this map” in its view.'),
      figure('The same inputs always give the same assignment file, and so the same fingerprint.', fingerprintDiagram()),
      exact(
        exactPara('fingerprint.repeat', 'Blocks are always processed in GEOID order. Given the same census files, the generator writes a byte-identical assignment file and identical district shapes on any computer. No cut depends on a computed angle; the angles shown are worked out by the generator’s own code, so they match everywhere too. The fingerprint is the SHA-256 hash of that assignment file.'),
      ),
      h('h3', { class: 'strv-how__h3' }, 'To reproduce a state’s map'),
      p('The generator, this viewer and the published data are all in ', h('a', { href: config.repoUrl }, 'the project’s GitHub repository'), '. Get the code and run it:'),
      h('pre', { class: 'strv-code', tabindex: 0, role: 'group', 'aria-label': 'Commands to run' }, recipeCode),
      p('Every map names the engine and Census input version that drew it. Same versions, same districts, every time. See what changed in each release on the ', h('a', { href: formatHash(CHANGELOG) }, 'changelog page'), '.'),
      p('The state is given by its two-letter abbreviation. The census block file for the state is downloaded from the U.S. Census Bureau the first time it is needed.'),
    ),
    section(
      'sources',
      7,
      h(
        'ul',
        { class: 'strv-how__list' },
        li(h('strong', null, '2020 Census blocks'), ', from the U.S. Census Bureau: people, shapes and internal points. The only data that draws the maps.'),
        li(h('strong', null, `${ordinal(ENACTED.congress)} Congress districts`), ', from the Census Bureau’s cartographic boundary file ', code(ENACTED.file), '. Shown for comparison only and never read by the generator. A state that adopted a new map after that file was made is not reflected in it.'),
        li(h('strong', null, 'State outlines and county names'), ', from the Census Bureau’s cartographic boundary files. Used for display and for counting the counties a district touches. The state outlines clipped to the shoreline (', code('cb_2020_us_state_500k'), ') also show where land ends and water begins.'),
        li(h('strong', null, 'Address search'), ' uses the U.S. Census Bureau geocoder. The address you type is sent to that service.'),
      ),
      figure('Only the census blocks draw the map. Everything else is display.', sourcesDiagram()),
      h('h3', { class: 'strv-how__h3' }, 'Limits'),
      h(
        'ul',
        { class: 'strv-how__list' },
        li('Zoomed out, district shapes are simplified so the maps load quickly. Zoomed in, they are drawn block by block. The numbers, and the file that assigns every block to a district, are never simplified.'),
        li('The maps are drawn from census blocks, and census blocks include water: they run out to the state’s legal boundary, across lakes, bays and coastal water. Each district therefore covers the water inside its edge, and that water is part of the district and counts toward connection. The viewer shows it paler so the land stands out, and shows the selected district’s water in full color. When a district uses an island link, the link appears as a dashed line while that district is selected. None of this changes the districts, the people counted or any number.'),
        li('Address search asks the Census Bureau which census block the address is in. When the Census Bureau names the block, address search reads that block’s district from the map file, so the answer is exact. Otherwise it uses the drawn shapes.'),
      ),
    ),
    h(
      'p',
      { class: 'strv-how__next' },
      'Why does a district look strange? How are ties settled? Short answers to common questions are on the ',
      h('a', { href: formatHash(faqRoute()) }, 'FAQ page'),
      '.',
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
      h('p', { class: 'strv-how__lede' }, 'Every map in this viewer comes from 2020 Census counts and three fixed steps: cut, keep blocks whole, balance. Here is each stage in plain language, with a drawing. Numbers in the drawings are examples unless they name a state. The maps cover the 50 states. Washington, D.C. and the U.S. territories elect non-voting delegates to the House, so they have no districts to draw.'),
    ),
    // The wrapper measures the room: the stage list sits beside the text only when the text keeps a readable measure.
    h('div', { class: 'strv-how__room' }, h('div', { class: 'strv-how__grid' }, toc, body)),
  );

  // The tables of real numbers arrive after the page, pushing the lower stages down. The section the
  // visitor asked for is kept in view until they scroll or press a key themselves.
  let anchor: HowSection | null = initial.section;
  let userMoved = false;
  const onUserMove = (): void => {
    userMoved = true;
  };
  const USER_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
  for (const ev of USER_EVENTS) window.addEventListener(ev, onUserMove, { passive: true });

  function headingOf(section: HowSection): HTMLElement | null {
    return el.querySelector<HTMLElement>(`#${sectionId(section)}-h`);
  }

  function scrollTo(section: HowSection | null, focus: boolean, animate = true): void {
    anchor = section;
    userMoved = false;
    if (!section) return;
    const target = headingOf(section);
    if (!target) return;
    requestAnimationFrame(() => {
      // jsdom has no scrollIntoView.
      if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'start', behavior: animate && !prefersReducedMotion() ? 'smooth' : 'auto' });
      if (focus) target.focus({ preventScroll: true });
    });
  }

  /** Called when late content has changed the page's height: put the requested section back at the top. */
  function keepAnchor(): void {
    if (!alive || !anchor || userMoved) return;
    const target = headingOf(anchor);
    if (!target) return;
    requestAnimationFrame(() => {
      if (alive && !userMoved && typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'start', behavior: 'auto' });
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
      keepAnchor();
    } catch (err) {
      if (!alive) return;
      clear(balanceSentence);
      balanceSentence.append(describeError(err), ' ');
      balanceSentence.append(h('button', { type: 'button', class: 'strv-button', onclick: () => void loadNumbers() }, 'Try again'));
      keepAnchor();
    }
  }

  async function loadRecipe(): Promise<void> {
    try {
      const co = (await loadIndex()).states.find((s) => s.abbr === 'CO');
      const maps = co?.summary?.versions?.maps;
      if (alive && maps !== undefined) recipeCode.textContent = reproduceCommands('CO', maps);
    } catch {
      // The recipe stays unpinned; the numbers section reports the failed load.
    }
  }

  async function loadFollow(): Promise<void> {
    try {
      const cuts = await fetchJson(dataUrl('CO/cuts.json'), CutsSchema);
      if (!alive) return;
      const rows = cutRows(cuts);
      const seats = rows[0]?.seats ?? 0;
      clear(followSentence);
      followSentence.append(
        `Colorado has ${formatInt(seats)} seats, so it takes ${formatInt(rows.length)} cuts. The first splits the whole state ${rows[0]?.split.replace(' + ', ' and ') ?? ''}; each side is then cut again, in the order below, until every piece has one seat. Each row opens Colorado’s map at that cut.`,
      );
      clear(followTable);
      followTable.append(followCutsTable(rows));
      keepAnchor();
    } catch (err) {
      if (!alive) return;
      clear(followSentence);
      followSentence.append(describeError(err), ' ');
      followSentence.append(h('button', { type: 'button', class: 'strv-button', onclick: () => void loadFollow() }, 'Try again'));
      keepAnchor();
    }
  }

  void loadNumbers();
  void loadFollow();
  void loadRecipe();
  document.title = 'How the districts are drawn | Fair Maps';
  markToc(initial.section);
  // On arrival there is nothing to scroll from, so jump; a smooth scroll would still be running when the late tables land.
  scrollTo(initial.section, false, false);

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
      destroyExact(el);
      for (const ev of USER_EVENTS) window.removeEventListener(ev, onUserMove);
    },
  };
}
