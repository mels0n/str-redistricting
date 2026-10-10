import { h, config, ENACTED, ordinal, formatHash, howRoute, faqRoute, stateRoute, iconArrowLeft, prefersReducedMotion, NATIONAL, FAQ_QUESTIONS, type FaqQuestion, type Page, type Route } from '../../shared';

const TITLES: Record<FaqQuestion, string> = {
  strange: 'Why does my district look strange?',
  block: 'What is a census block?',
  ties: 'How are ties settled?',
  data: 'Does it use party, voting or race data?',
  counties: 'Why doesn’t it follow county or city lines?',
  equal: 'Why aren’t the districts exactly equal?',
  current: 'Is this my district today?',
  water: 'Why does a district cross water, or show dashed lines?',
  'one-seat': 'Why does my state have only one district, and where is D.C.?',
  check: 'How can I check a map myself?',
  terms: 'What do the other terms mean?',
};

const questionId = (q: FaqQuestion): string => `strv-faq-${q}`;

const p = (...children: (Node | string)[]): HTMLElement => h('p', null, ...children);
const li = (...children: (Node | string)[]): HTMLElement => h('li', null, ...children);
const list = (...items: HTMLElement[]): HTMLElement => h('ul', { class: 'strv-how__list' }, items);
const howLink = (section: Parameters<typeof howRoute>[0], text: string): HTMLElement => h('a', { href: formatHash(howRoute(section)) }, text);

function question(id: FaqQuestion, n: number, ...body: HTMLElement[]): HTMLElement {
  return h(
    'section',
    { class: 'strv-how__section', id: questionId(id), 'aria-labelledby': `${questionId(id)}-h` },
    h('h2', { class: 'strv-how__h2', id: `${questionId(id)}-h`, tabindex: -1 }, h('span', { class: 'strv-how__no', 'aria-hidden': 'true' }, String(n)), TITLES[id]),
    ...body,
  );
}

const ANSWERS: Record<FaqQuestion, () => HTMLElement[]> = {
  strange: () => [
    p('A strange shape is not a mistake. The generator runs the same steps in every state, and the map is whatever those steps produce. Nobody looks at the result and fixes it.'),
    p('The generator doesn’t know what a town, a county, a river, a highway or a neighborhood is. All it sees is how many people live in each census block and the block’s shape. So a line can run through a city, split a county or cross a bay. Bays are made of census blocks too.'),
    p('“It looks wrong” usually means it doesn’t match a picture you already have, like the old district lines, the county map, or where you feel your area ends. People drew those pictures. Making the map match them would mean adding back the human choices this method leaves out.'),
    h('h3', { class: 'strv-how__h3' }, 'Where odd edges come from'),
    list(
      li(h('strong', null, 'Stair steps.'), ' The line follows census block edges and keeps every block whole, so a straight guide line becomes a ragged border.'),
      li(h('strong', null, 'Notches and small bumps.'), ' The balancing pass moves single blocks across borders to even out the population, one block at a time.'),
      li(h('strong', null, 'Across water.'), ' Water is census blocks like any other, so a district can join two shores, and an island link can join land no block reaches.'),
      li(h('strong', null, 'Long or thin pieces.'), ' The shortest border wins each cut, and the people, not a neat outline, decide where that is. Sometimes it leaves a long piece.'),
    ),
    h('h3', { class: 'strv-how__h3' }, 'Check it yourself'),
    p('Every border traces back to a cut or a balancing move, and both can be replayed on the state’s map, ', h('a', { href: formatHash(stateRoute('CO', { cut: 1 })) }, 'starting with Colorado’s first cut'), '. Anyone who reruns the generator gets the same map and the same fingerprint.'),
    p('The rules themselves, shortest border and equal population, were chosen once and up front. They apply to every state alike and were fixed before any map existed. Nobody chose any single line.'),
  ],
  block: () => [
    p('A census block is the smallest area the U.S. Census Bureau counts people in. Blocks are bounded by things on the ground, such as streets, streams and railroad tracks, or by lines such as city and property limits. In a city a block is often an ordinary city block; in the countryside one can cover many square miles.'),
    p('Every person in the country is counted in exactly one block, and the census publishes how many people live in each one. Some blocks have nobody in them. Blocks also cover lakes, bays and coastal water, out to the state’s legal boundary.'),
    p('The maps are built from whole blocks. A block is never split between two districts, because the census only counts people per block: there is no count for part of one. That is why district borders follow block edges.'),
  ],
  ties: () => [
    p('Every tie has a fixed tiebreak, written down before any map was drawn. Nothing is left to chance or to a person. Where a tiebreak uses GEOID order, that is the census block identifier, a number the Census Bureau gives every block.'),
    list(
      li(h('strong', null, 'Two borders the same length.'), ' Lengths are compared exactly as measured, so two borders tie only when they are exactly equal. When two different cuts tie, the one whose sides are nearer their fair shares of people is used, and if that is equal too, GEOID decides. No direction is preferred. Exact ties are rare.'),
      li(h('strong', null, 'Where a cut stops.'), ' A cut adds up people block by block until one side has its share. If stopping just before a block and just after it land equally close to the share, both stopping points are kept as candidates and the border rules above choose between them.'),
      li(h('strong', null, 'Blocks side by side.'), ' Blocks whose internal points are in exactly the same place are put in GEOID order.'),
      li(h('strong', null, 'Which piece keeps its side.'), ' When a cut leaves a side in more than one piece, the piece with the most people stays, then the one holding the lower GEOID. The others are stray pieces and join the side around them.'),
      li(h('strong', null, 'Which district balances first.'), ' If two districts are equally far from the ideal population, the one whose first block comes first in GEOID order goes first.'),
      li(h('strong', null, 'Two equally good balancing moves.'), ' The move that leaves the shorter total border wins, then the block that comes first in GEOID order. If that block could go to two districts with the same result, it goes to the one whose first block comes first in GEOID order. District numbers never settle a tie.'),
      li(h('strong', null, 'Two island links the same length.'), ' The link between the blocks that come first in GEOID order is added.'),
    ),
    p('Each of these is spelled out under “The exact rule” in ', howLink('cut', 'One cut'), ', ', howLink('strays', 'Stray pieces'), ' and ', howLink('balancing', 'Balancing'), '.'),
  ],
  data: () => [
    p('No. Three facts about each census block go in: how many people the census counted there, where its edges are, and one point inside it, used to put blocks in order and to measure island links. Each state’s number of House seats goes in too. Nothing else does.'),
    p('Party registration, election results, where officeholders or candidates live, current or past district lines, and race, ethnicity, age or income never go in. See ', howLink('inputs', 'What goes in'), '.'),
  ],
  counties: () => [
    p('County and city lines are never used to draw anything. The generator only knows people and block shapes, so a district border can split a county or a city when that gives the shortest border.'),
    p('Counties are counted afterwards, for reporting only: the district list shows how many counties each district touches.'),
  ],
  equal: () => [
    p('They are as close as whole census blocks allow. People come whole, and a state’s population rarely divides evenly by its seats, so an even split already differs by one person. Missouri’s 6,154,913 people and 8 seats make an ideal of 769,364.125, so an even split puts each district at 769,364 or 769,365.'),
    p('Each cut stops at the block that brings its sides closest to their shares. Then a balancing pass trades single blocks between neighboring districts, one at a time, as long as a trade narrows the gap and keeps both districts in one piece. It stops when no single-block trade helps. Blocks are never split, so a small difference can remain. See ', howLink('balancing', 'Balancing, and why it is needed'), ', which lists the result in every state.'),
  ],
  current: () => [
    p('No. These maps are drawn by the generator and are not the districts in use. To see the current lines, turn on “Compare with” on a state’s map: they are drawn as dashed lines, for comparison only. They come from the Census Bureau’s file of ', `${ordinal(ENACTED.congress)} Congress districts`, ', so a state that adopted a new map after that file was made is not reflected.'),
  ],
  water: () => [
    p('Census blocks cover lakes, bays and coastal water out to the state’s legal boundary, and a water block is a block like any other. So a district can join two shores across water. The map shows water paler so the land stands out, and shows the selected district’s water in full color.'),
    p('Some land is not reached by any block, even across water, such as some islands. The generator joins it with an island link: the shortest link between internal points, added until every piece is connected. When you select a district, its links show as dashed lines. See the island rule under “The exact rule” in ', howLink('strays', 'Stray pieces and the re-count'), '.'),
  ],
  'one-seat': () => [
    p('Each state gets the number of House seats from the 2020 apportionment. A state with one seat is one district covering the whole state, so there is nothing to cut.'),
    p('Washington, D.C. and the U.S. territories elect non-voting delegates to the House, so they have no districts to draw.'),
  ],
  check: () => [
    p('Every map has a fingerprint, a 64-character code worked out from the file that lists every block and its district. It is printed under “Check this map” on each state’s page. Change one block and the code changes completely.'),
    p('The generator, this viewer and the published data are in ', h('a', { href: config.repoUrl }, 'the project’s GitHub repository'), '. Run it on the same Census data and you get the same map and the same fingerprint, on any computer. See ', howLink('fingerprint', 'Same data, same map'), '.'),
  ],
  terms: () => [
    p('The words this site uses, in the order you meet them.'),
    h(
      'dl',
      { class: 'strv-faq__terms' },
      TERMS.flatMap(([term, meaning]) => [h('dt', null, term), h('dd', null, meaning)]),
    ),
  ],
};

/** Plain meanings of the site's terms. */
const TERMS: readonly (readonly [string, string])[] = [
  ['Census block', 'The smallest area the Census Bureau counts people in. Every person is counted in exactly one. More under “What is a census block?” above.'],
  ['GEOID', 'The identifier the Census Bureau gives every block: a 15-digit number made of its state, county, tract and block codes. Sorting by it gives one fixed order, which settles ties.'],
  ['Internal point', 'One point inside each block, published by the Census Bureau. It is used to put blocks in order across a guide line and to measure island links.'],
  ['Apportionment', 'How the 435 House seats are shared out among the states after each census. These maps use the 2020 apportionment.'],
  ['Seat', 'One member of the House. A state gets one district per seat.'],
  ['Cut', 'One split of a piece of the state into two sides, each with its share of the seats and the people. A state with N seats takes N minus 1 cuts.'],
  ['Guide line', 'A straight line tried during a cut. It only decides which side each block joins; the real border then follows block edges.'],
  ['Share', 'The number of people one side of a cut should hold: the piece’s people times that side’s seats, divided by the piece’s seats.'],
  ['Border length', 'How long a cut’s real border is, measured along block edges. Of all the lines that work, the shortest border wins.'],
  ['Stray piece', 'A block, or a group of blocks, cut off from the rest of its side by a guide line. It joins the side around it.'],
  ['Re-count', 'After stray pieces move, the people are counted again and the line slides so each side still holds its share.'],
  ['Connected', 'In one piece. Two blocks are connected when they share an edge; touching at a single corner does not count.'],
  ['Island link', 'A link added between land that no block reaches, such as an island, and the rest of the state, so the state can still be cut. Shown as a dashed line on a selected district.'],
  ['Ideal population', 'A state’s population divided by its number of seats: what each district would hold if people divided evenly.'],
  ['Even split', 'The ideal rounded down or up to whole people. The map shows how far each district is from it.'],
  ['Balancing', 'The last step: single blocks move between neighboring districts, one at a time, while that brings the districts closer to equal.'],
  ['Fingerprint', 'A 64-character code worked out from the file that assigns every block to a district. The same map always gives the same code.'],
  ['Current districts', 'The districts in use today, from the Census Bureau’s file. Shown as dashed lines for comparison only, never used to draw.'],
];

/** Common questions, each answered briefly and linked to the How it works stage that explains it in full. */
export function createFaqPage(initial: Extract<Route, { page: 'faq' }>): Page {
  const h1 = h('h1', { class: 'strv-how__h1', tabindex: -1 }, 'Frequently asked questions');

  const toc = h(
    'nav',
    { class: 'strv-how__toc', 'aria-labelledby': 'strv-faq-toc-h' },
    h(
      'div',
      { class: 'strv-how__toc-inner' },
      h('h2', { id: 'strv-faq-toc-h', class: 'strv-how__toc-h' }, 'Questions'),
      h(
        'ol',
        { class: 'strv-how__toc-list' },
        FAQ_QUESTIONS.map((q, i) =>
          h('li', null, h('a', { href: formatHash(faqRoute(q)), 'data-question': q }, h('span', { class: 'strv-how__toc-no', 'aria-hidden': 'true' }, String(i + 1)), TITLES[q])),
        ),
      ),
    ),
  );

  const body = h('div', { class: 'strv-how__body' }, FAQ_QUESTIONS.map((q, i) => question(q, i + 1, ...ANSWERS[q]())));

  const el = h(
    'main',
    { class: 'strv-how strv-faq', id: 'strv-main' },
    h(
      'header',
      { class: 'strv-how__head' },
      h('a', { href: formatHash(NATIONAL), class: 'strv-back' }, iconArrowLeft(), 'All states'),
      h1,
      h('p', { class: 'strv-how__lede' }, 'Short answers to the questions people ask most. Each links to the part of ', h('a', { href: formatHash(howRoute()) }, 'How it works'), ' that explains it in full.'),
    ),
    h('div', { class: 'strv-how__room' }, h('div', { class: 'strv-how__grid' }, toc, body)),
  );

  const headingOf = (q: FaqQuestion): HTMLElement | null => el.querySelector<HTMLElement>(`#${questionId(q)}-h`);

  function scrollTo(q: FaqQuestion | null, focus: boolean, animate: boolean): void {
    if (!q) return;
    const target = headingOf(q);
    if (!target) return;
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: 'start', behavior: animate && !prefersReducedMotion() ? 'smooth' : 'auto' });
      if (focus) target.focus({ preventScroll: true });
    });
  }

  function markToc(q: FaqQuestion | null): void {
    for (const a of toc.querySelectorAll<HTMLAnchorElement>('a[data-question]')) {
      if (a.dataset.question === q) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    }
  }

  document.title = 'FAQ | Fair Maps';
  markToc(initial.question);
  scrollTo(initial.question, false, false);

  return {
    el,
    focusTarget: () => (initial.question ? headingOf(initial.question) : h1),
    update(next) {
      if (next.page !== 'faq') return false;
      markToc(next.question);
      if (next.question) scrollTo(next.question, true, true);
      else {
        window.scrollTo(0, 0);
        h1.focus({ preventScroll: true });
      }
      return true;
    },
    destroy() {},
  };
}
