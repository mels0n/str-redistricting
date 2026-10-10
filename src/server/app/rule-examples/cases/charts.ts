import {
  chosenCandidate, generatedStates, loadCandidates, loadMetricsIfPresent, numberField, type CaseBuilder, type ExtractContext, type RuleCase,
} from '../../../features/rule-examples/index.js';
import { DataError } from '../../../shared/errors/index.js';
import { nameOf, people, whole } from './panel.js';
import { cutTrace } from './trace.js';

type Label = NonNullable<RuleCase['labels']>[number];

const VIEW = { w: 320, h: 180 };
/** Where axis words sit: on the row under the plot, at its two ends. The chart reserves this strip. */
const AXIS_Y = 170;
const AXIS_L = 24;
const AXIS_R = 296;

/** The preferred cut for the order of the checks (orderCut looks elsewhere when it no longer skips a range). */
const ORDER = { abbr: 'MS', cut: 1 } as const;
const BALANCE_STATE = 'CO';
/** A two-district state, where the two districts are always exactly as far from the ideal as each other. */
const TIE_STATE = 'HI';

const round2 = (n: number): number => Math.round(n * 100) / 100;
const axisLabel = (id: string, x: number, text: string): Label => ({ id, x, y: AXIS_Y, text });

/** The 0-based index of the value furthest from zero on either side; the lower index when two are equally far. */
export function furthestOf(devs: readonly number[]): number {
  let best = 0;
  devs.forEach((d, i) => { if (Math.abs(d) > Math.abs(devs[best]!)) best = i; });
  return best;
}

/** How far apart two lengths are, in words: meters from a meter up, centimeters from a centimeter, millimeters down to a micrometer. */
export function gapWords(m: number): string {
  if (m >= 1) return `${people(round2(m))} m`;
  if (m >= 0.01) return `${(m * 100).toFixed(1)} cm`;
  if (m >= 1e-6) return `${(m * 1000).toPrecision(2)} mm`;
  return 'less than a thousandth of a millimeter';
}

/** One candidate (a range of directions that all give the same sides), as candidates.json lists it. */
export interface Cand {
  readonly lowSeats: number;
  readonly fromDeg: number;
  readonly toDeg: number;
  readonly lengthM: number;
}

/** A cut's candidate rows as records, in the order the generator tries them. Columns are found by name, so older files with extra columns still read. */
function candidatesOf(rows: readonly number[][], fields: readonly string[]): Cand[] {
  const at = (f: string): number => fields.indexOf(f);
  const [lowAt, fromAt, toAt, lenAt] = [at('lowSeats'), at('fromDeg'), at('toDeg'), at('lengthM')];
  if (lowAt < 0 || fromAt < 0 || toAt < 0 || lenAt < 0) throw new DataError('candidates.json is missing a column the charts read');
  return rows.map((r) => ({ lowSeats: r[lowAt]!, fromDeg: r[fromAt]!, toDeg: r[toAt]!, lengthM: r[lenAt]! }));
}

/** The two best candidates of a cut in the generator's order, or undefined when the cut lists fewer than two. */
export function shortestTwo(rows: readonly number[][], fields: readonly string[]): [Cand, Cand] | undefined {
  const list = candidatesOf(rows, fields);
  for (let i = 1; i < list.length; i++) {
    if (list[i]!.lengthM < list[i - 1]!.lengthM) throw new DataError("candidates.json rows are not in the generator's order (a later row is shorter)");
  }
  return list.length < 2 ? undefined : [list[0]!, list[1]!];
}

/** Whole micrometers between two lengths in meters. */
export const gapUm = (a: number, b: number): number => Math.round((b - a) * 1e6);

/** A direction for display: up to four decimals, no trailing zeros. */
const degExact = (angle: number): string => `${Number(angle.toFixed(4))}°`;
/** A range of directions for display. */
const rangeOf = (c: Pick<Cand, 'fromDeg' | 'toDeg'>): string => `${degExact(c.fromDeg)} to ${degExact(c.toDeg)}`;
/** Meters as kilometers to one decimal. */
const km = (m: number): string => (m / 1000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** Fewest leading ranges the order-of-checks chart needs to be worth drawing. */
const MIN_RANGES = 12;

/** The cut that shows the order of the checks: shorter ranges are skipped for sides that are not each connected. */
async function orderCut(ctx: ExtractContext): Promise<{ abbr: string; order: number }> {
  const fits = async (abbr: string, order: number): Promise<boolean> => {
    const out = await ctx.state(abbr);
    const at = out.cutStats.cuts.findIndex((c) => c.order === order);
    const cut = out.cutStats.cuts[at];
    return !!cut && numberField(cut, 'skipped', abbr) >= 1 && (out.candidates.cuts[at]?.length ?? 0) >= MIN_RANGES;
  };
  if (await fits(ORDER.abbr, ORDER.cut)) return { abbr: ORDER.abbr, order: ORDER.cut };
  // The preferred cut no longer shows it: the first cut 1, by state, that does.
  for (const abbr of generatedStates(ctx.cfg.outDir)) if (await fits(abbr, 1)) return { abbr, order: 1 };
  throw new DataError('no cut 1 in any state skips a range and lists enough candidates to show the order of the checks');
}

/** cut.order-of-checks: every straight line falls into ranges of directions; each range is checked once, shortest border first. */
export async function orderOfChecksCase(ctx: ExtractContext): Promise<RuleCase> {
  const { abbr, order } = await orderCut(ctx);
  const out = await ctx.state(abbr);
  const at = out.cutStats.cuts.findIndex((c) => c.order === order);
  const cut = out.cutStats.cuts[at];
  const all = out.candidates.cuts[at];
  if (!cut || !all) throw new DataError(`${abbr}: no cut ${order} in the cut data`);
  const skipped = numberField(cut, 'skipped', `${abbr} cut ${order}`);
  const ranges = numberField(cut, 'candidateRanges', `${abbr} cut ${order}`);
  const list = candidatesOf(all, out.candidates.fields);
  const n = list.length;
  chosenCandidate(out, at);
  const first = list[0]!;
  if (first.fromDeg !== cut.fromDeg || first.toDeg !== cut.toDeg || first.lowSeats !== cut.lowSeats) throw new DataError(`${abbr} cut ${order}: the first candidate is not the cut on disk`);
  if (skipped < 1) throw new DataError(`${abbr} cut ${order}: no range was skipped, so this cut no longer shows the order of the checks`);

  // The leading ranges in direction order (ties by seats), so sorting them by length is a visible step.
  const byDirection = list.map((c, i) => ({ c, i })).sort((p, q) => p.c.fromDeg - q.c.fromDeg || p.c.lowSeats - q.c.lowSeats);
  const values = byDirection.map(({ c }) => c.lengthM / 1000);
  const winnerAt = byDirection.findIndex(({ i }) => i === 0);

  const name = nameOf(abbr);
  const top = values.reduce((a, v) => Math.max(a, v), 0);
  const base = ['chart', 'ymax'];
  const angles = [...base, 'x-angle-l', 'x-angle-r'];
  const byLength = [...base, 'x-sorted-l', 'x-sorted-r', 'chart-sorted'];
  const skippedWords = skipped === 1 ? 'One shorter border length belongs' : `${whole(skipped)} shorter border lengths belong`;
  return {
    id: 'cut.order-of-checks',
    state: abbr,
    stateName: name,
    source: { cut: cut.order, angleDeg: cut.angleDeg },
    link: { state: abbr, cut: cut.order },
    view: VIEW,
    labels: [
      { id: 'ymax', x: 44, y: 11, text: `${whole(Math.round(top))} km` },
      axisLabel('x-angle-l', AXIS_L, 'smaller angle'),
      axisLabel('x-angle-r', AXIS_R, 'larger angle'),
      axisLabel('x-sorted-l', AXIS_L, 'shortest'),
      axisLabel('x-sorted-r', AXIS_R, 'longest'),
    ],
    steps: [
      { caption: `${name}'s first cut tries every straight line. Turning the line, the directions fall into stretches: every direction inside one stretch splits the people the same way. Cut ${cut.order} has ${whole(ranges)} such stretches${cut.seats % 2 === 1 ? ', counting each way of splitting the seats' : ''}. Each tick is one of the ${whole(n)} leading stretches (the best few from every part of the half turn), in order of direction, at the length of its border.`, show: angles },
      { caption: 'Each stretch is checked once, however wide it is. Its line is first settled for stray pieces, and only then is its real border measured. Each tick is that measured length.', show: angles },
      { caption: 'Now the stretches are sorted by border length, shortest first.', show: byLength },
      { caption: `Not every stretch can be used. ${skippedWords} to stretches that are shorter still but whose two sides are not each one connected piece. They are skipped, and are not drawn here.`, show: byLength },
      {
        caption: `The shortest stretch left, ${rangeOf(first)} from north-south at ${km(first.lengthM)} km, has two connected sides, so it is the cut. The guide line is drawn through its middle, ${degExact(cut.angleDeg)}. It is the ${degExact(cut.angleDeg)} and ${whole(Math.round(cut.lengthM))} m of cut ${cut.order} on the real map.`,
        show: [...byLength, 'chart-winner'],
      },
    ],
    chart: { kind: 'strip', values, marks: { winner: [winnerAt] } },
  };
}

interface Close {
  readonly abbr: string;
  readonly blocks: number;
  readonly order: number;
  readonly gapUm: number;
  readonly pair: [Cand, Cand];
}

interface CloseCalls {
  readonly states: number;
  readonly cuts: number;
  /** Cuts whose two best borders are exactly equal, to the micrometer. */
  readonly equal: number;
  readonly closest: Close;
}

/**
 * The search behind cut.ties: for every cut of every generated state, the two best candidates and how far apart their
 * borders are (exact, in whole micrometers). The closest pair, on the fewest blocks, is the example.
 */
export async function closeCalls(ctx: ExtractContext): Promise<CloseCalls> {
  const { outDir } = ctx.cfg;
  const abbrs = generatedStates(outDir);
  let cuts = 0, equal = 0;
  let closest: Close | undefined;
  for (const abbr of abbrs) {
    const [metrics, cands] = await Promise.all([loadMetricsIfPresent(outDir, abbr), loadCandidates(outDir, abbr)]);
    if (!metrics) continue;
    const blocks = numberField(metrics, 'blocks', abbr);
    cands.cuts.forEach((rows, i) => {
      const pair = shortestTwo(rows, cands.fields);
      if (!pair) return;
      cuts++;
      const gap = gapUm(pair[0].lengthM, pair[1].lengthM);
      if (gap === 0) equal++;
      const here: Close = { abbr, blocks, order: i + 1, gapUm: gap, pair };
      if (!closest || gap < closest.gapUm || (gap === closest.gapUm && blocks < closest.blocks)) closest = here;
    });
  }
  if (!closest) throw new DataError(`${outDir}: no cuts to search for ties`);
  return { states: abbrs.length, cuts, equal, closest };
}

/** The tie rules in plain words: they settle two different cuts whose borders are exactly equal. */
const RULE_ORDER = 'shortest border, then the sides nearer their fair shares of people, then GEOID';
const GEOID_HOW = "find the lowest GEOID among the blocks the two cuts put on different sides, and use the cut that puts that block on the same side as the piece's lowest GEOID.";

/**
 * What happens when two borders are exactly equal, in words. `same`: both stretches give the same two sides, so they
 * are one cut and nothing is decided. Otherwise the cuts differ and the people rule, then the GEOID rule, picks one.
 */
export function tieRuleText(first: Cand, kind: 'same' | 'geoid'): string {
  if (kind === 'same') {
    return `Both stretches give the same two sides, so they are one cut and nothing needs deciding. The guide line is drawn in the first stretch clockwise from north-south, ${rangeOf(first)}.`;
  }
  return `The cut whose sides are nearer their fair shares of people is used. If that is exactly equal too, GEOID decides: ${GEOID_HOW}`;
}

/** cut.ties: the closest call in any state, with exact lengths, and the rule for choosing between cuts of equal border. */
export async function tiesCase(ctx: ExtractContext): Promise<RuleCase> {
  const found = await closeCalls(ctx);
  const { abbr, order } = found.closest;
  const t = await cutTrace(ctx, abbr, order);
  const [x, y] = t.result.candidates;
  if (!x || !y) throw new DataError(`${abbr} cut ${order}: the re-run lists fewer than two candidates`);
  const [first, second] = found.closest.pair;
  if (x.fromDeg !== first.fromDeg || x.toDeg !== first.toDeg || y.fromDeg !== second.fromDeg || y.toDeg !== second.toDeg) {
    throw new DataError(`${abbr} cut ${order}: the re-run's two best candidates are not the ones on disk (stale out/?)`);
  }
  if (x.lengthM > y.lengthM) throw new DataError(`${abbr} cut ${order}: the two best candidates are not in the generator's order`);
  if (first.fromDeg !== t.cut.fromDeg || first.toDeg !== t.cut.toDeg) throw new DataError(`${abbr} cut ${order}: the best candidate is not the cut on disk`);
  const [lenFirst, lenSecond] = [first.lengthM, second.lengthM];
  const tied = found.closest.gapUm === 0;
  const name = nameOf(abbr);
  const [a, b] = [rangeOf(first), rangeOf(second)];
  const meters = (m: number): string => people(round2(m));
  const mark = tied ? 'tied' : 'close';
  // Equal borders from stretches with the same two sides are one cut; only different sides at an equal border go to GEOID.
  const rule = tieRuleText(first, tied && t.result.tiedCuts >= 2 ? 'geoid' : 'same');

  const search = found.equal > 0
    ? `Searching every cut in all ${found.states} states: in ${found.equal} of ${whole(found.cuts)} cuts the two best borders are exactly equal, to the micrometer. The one on the fewest blocks is ${name}'s cut ${order}.`
    : `Searching every cut in all ${found.states} states: in none of ${whole(found.cuts)} cuts are the two best borders exactly equal, to the micrometer. The closest call is ${name}'s cut ${order}.`;

  return {
    id: 'cut.ties',
    state: abbr,
    stateName: name,
    source: { cut: order, angleDeg: t.cut.angleDeg },
    link: { state: abbr, cut: order },
    view: VIEW,
    steps: [
      { caption: search, show: [] },
      { caption: `${name}'s cut ${order} splits ${t.cut.seats} seats. Its two best borders belong to the stretches of directions ${a} and ${b} from north-south.`, show: ['chart'] },
      {
        caption: tied
          ? `Both stretches give exactly the same border length, so they are tied.`
          : lenSecond - lenFirst < 0.11
            ? `The closest call in any state: the borders differ by ${gapWords(lenSecond - lenFirst)}, less than the census outlines can resolve (about 11 cm), but the rule only calls a tie when the stored lengths are exactly equal. Not a tie.`
            : `The closest call in any state: the borders differ by ${gapWords(lenSecond - lenFirst)}. Not a tie.`,
        show: ['chart', `chart-${mark}`],
      },
      {
        caption: tied
          ? `The rule is ${RULE_ORDER}. ${rule}`
          : `Not a tie, so the shorter border, the stretch ${a}, is the one used. The rule is ${RULE_ORDER}. Had two different cuts had exactly equal borders, the one nearer its fair shares of people would be used, and if that were equal too, GEOID would decide: ${GEOID_HOW}`,
        show: ['chart', `chart-${mark}`],
      },
      {
        caption: `So the cut is the stretch ${a}. Its guide line is drawn through the middle, ${degExact(t.cut.angleDeg)}. On the real map, ${name} cut ${order} is ${degExact(t.cut.angleDeg)} and ${whole(Math.round(t.cut.lengthM))} m.`,
        show: ['chart', `chart-${mark}`, 'chart-winner'],
      },
    ],
    chart: { kind: 'bars', values: [round2(lenFirst), round2(lenSecond)], labels: [a, b], marks: { [mark]: [0, 1], winner: [0] } },
  };
}

/** balance.furthest: each district's distance from the ideal before balancing, and the one the pass starts with. */
export async function furthestCase(ctx: ExtractContext): Promise<RuleCase> {
  const abbr = BALANCE_STATE;
  const [out, hi] = await Promise.all([ctx.state(abbr), ctx.state(TIE_STATE)]);
  const { ideal } = out.metrics;
  const devs = out.balance.before.map((p) => p - ideal);
  const worst = furthestOf(devs);
  const move = out.balance.moves[0];
  if (!move || (move.from !== worst + 1 && move.to !== worst + 1)) throw new DataError(`${abbr}: the first move does not involve the furthest district`);
  // The furthest district on the other side of the ideal, to show that the side does not matter.
  const sign = Math.sign(devs[worst]!);
  const others = devs.map((d, i) => [d, i] as const).filter(([d]) => Math.sign(d) === -sign);
  const rival = others.reduce((best, [d, i]) => (Math.abs(d) > Math.abs(devs[best]!) ? i : best), others[0]?.[1] ?? -1);
  if (rival < 0) throw new DataError(`${abbr}: every district is on one side of the ideal`);

  const hiDevs = hi.balance.before.map((p) => p - hi.metrics.ideal);
  if (hiDevs.length !== 2 || Math.abs(hiDevs[0]!) !== Math.abs(hiDevs[1]!)) throw new DataError(`${TIE_STATE}: its two districts are not equally far from the ideal`);
  const side = (d: number): string => (d > 0 ? 'over' : 'under');
  const dist = (i: number): string => `District ${i + 1} is ${people(Math.abs(devs[i]!))} ${side(devs[i]!)}`;
  const name = nameOf(abbr);

  return {
    id: 'balance.furthest',
    state: abbr,
    stateName: name,
    source: { move: 1 },
    link: { state: abbr, move: 1 },
    view: VIEW,
    steps: [
      { caption: `${name}'s ideal is ${people(ideal)} people per district. Each bar is how far a district is from it before balancing: above the line is over, below is under.`, show: ['chart'] },
      { caption: `Distance counts either way. ${dist(worst)} and ${dist(rival)}, so District ${worst + 1} is further.`, show: ['chart', 'chart-runnerUp', 'chart-furthest'] },
      {
        caption: `District ${worst + 1} goes first. The first real move takes ${whole(out.balance.moves[0]!.pop)} people out of District ${move.from} and into District ${move.to}.`,
        show: ['chart', 'chart-furthest'],
      },
      {
        caption: `If two districts are exactly as far, the lower number goes first. ${nameOf(TIE_STATE)}'s two districts are each ${people(Math.abs(hiDevs[0]!))} people from its ideal of ${people(hi.metrics.ideal)}, one over and one under, so District 1 goes first.`,
        show: [],
      },
    ],
    chart: { kind: 'bars', values: devs, labels: devs.map((_, i) => String(i + 1)), marks: { runnerUp: [rival], furthest: [worst] } },
  };
}

/** balance.stop: the sum of squared distances falls with every move until none helps. */
export async function stopCase(ctx: ExtractContext): Promise<RuleCase> {
  const abbr = BALANCE_STATE;
  const out = await ctx.state(abbr);
  const { ideal, districts } = out.metrics;
  const { before, moves } = out.balance;
  const sumOfSquares = (pops: readonly number[]): number => pops.reduce((s, p) => s + (p - ideal) * (p - ideal), 0);
  const values = [sumOfSquares(before)];
  for (const m of moves) values.push(values[values.length - 1]! - m.gain);
  const final = values[values.length - 1]!;
  if (final !== sumOfSquares(districts.map((d) => d.pop))) throw new DataError(`${abbr}: the moves' gains do not add up to the final plan`);
  const range = (pops: readonly number[]): number => Math.max(...pops) - Math.min(...pops);
  const [rangeBefore, rangeAfter] = [numberField(out.metrics, 'rangeBeforeBalancing', abbr), numberField(out.metrics, 'rangeAfterBalancing', abbr)];
  if (range(before) !== rangeBefore || range(districts.map((d) => d.pop)) !== rangeAfter) throw new DataError(`${abbr}: the ranges in metrics.json do not match the populations`);
  const n = moves.length;
  const lowest = moves.reduce((m, x) => Math.min(m, x.gain), Infinity);
  const name = nameOf(abbr);
  const chart = ['chart', 'x-start', 'x-end'];

  return {
    id: 'balance.stop',
    state: abbr,
    stateName: name,
    source: { move: n },
    link: { state: abbr, move: n },
    view: VIEW,
    labels: [axisLabel('x-start', AXIS_L, 'Start'), axisLabel('x-end', AXIS_R, `Move ${n}`)],
    steps: [
      {
        caption: `Before balancing, ${name}'s districts run from ${whole(Math.min(...before))} to ${whole(Math.max(...before))} people, a range of ${whole(rangeBefore)}. Squaring each district's distance from the ideal ${people(ideal)} and adding up gives ${people(values[0]!)}.`,
        show: [...chart, 'chart-first'],
      },
      { caption: `Each of the ${n} moves lowers that sum, the first by ${whole(moves[0]!.gain)} and the last by ${whole(moves[n - 1]!.gain)}. Each dot is the sum after a move.`, show: chart },
      { caption: `After ${n} moves the sum is ${people(final)} and the range is ${whole(rangeAfter)}.`, show: [...chart, 'chart-last'] },
      { caption: `No move lowers the sum any further, so the pass stops. It always does: every move lowers the sum by at least ${whole(lowest)}, and a sum of squares never goes below zero.`, show: [...chart, 'chart-last'] },
    ],
    chart: { kind: 'series', values, marks: { first: [0], last: [n] } },
  };
}

export const chartCases: readonly CaseBuilder[] = [orderOfChecksCase, tiesCase, furthestCase, stopCase];
