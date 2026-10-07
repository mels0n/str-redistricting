import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { forEachEdge, type Block, type BlockPolygons } from '../../../entities/census-block/index.js';
import { CutLinesSchema } from '../../../entities/plan-output/index.js';
import { projectWindow, type CaseBuilder, type ExtractContext, type RuleCase } from '../../../features/rule-examples/index.js';
import { selectLow, type CandidateTrace } from '../../../features/splitline/index.js';
import { stateByAbbr } from '../../../shared/apportionment/index.js';
import { cos, sin } from '../../../shared/detmath/index.js';
import { DataError } from '../../../shared/errors/index.js';
import { greatCircleDistance, type LonLat } from '../../../shared/geo/index.js';
import { clip, densify, dot, fit, foot, greatCircle, people, round1, stateOutline, whole, type P } from './panel.js';
import { cutTrace, splitContextOf, type CutTrace } from './trace.js';

export { cutTrace } from './trace.js';
export type { CutTrace } from './trace.js';

type Line = NonNullable<RuleCase['lines']>[number];
type Label = NonNullable<RuleCase['labels']>[number];
type RuleBlock = NonNullable<RuleCase['blocks']>[number];

const W = 320;
/** Blocks shown in a window. */
const WINDOW = 20;
/** The one-cut panels use Colorado's third cut (two seats around Denver's northern suburbs) and Alabama's first. */
const CO_CUT = 3;

function nameOf(abbr: string): string {
  const info = stateByAbbr(abbr);
  if (!info) throw new DataError(`unknown state: ${abbr}`);
  return info.name;
}

/** Walk position of every block of the piece (-1 outside it). */
function ranks(t: CutTrace, tr: CandidateTrace): Int32Array {
  const rank = new Int32Array(t.blocks.length).fill(-1);
  tr.order.forEach((b, i) => { rank[b] = i; });
  return rank;
}

/** The `n` blocks of the piece whose internal points are nearest `at`, nearest first (ties by block index). */
function nearest(t: CutTrace, at: LonLat, n: number): number[] {
  return Array.from(t.members, (b) => [b, greatCircleDistance(at, t.blocks[b]!.point)] as const)
    .sort((p, q) => p[1] - q[1] || p[0] - q[0])
    .slice(0, n)
    .map(([b]) => b);
}

/** Middle of the longest span of a guide line. */
function middleOf(spans: CandidateTrace['passes'][number]['spans']): LonLat {
  let best = spans[0]!;
  for (const s of spans) if (greatCircleDistance(s[0], s[1]) > greatCircleDistance(best[0], best[1])) best = s;
  return greatCircle(best[0], best[1], 2)[1]!;
}

interface BlockPanel {
  /** Block indices in walk order. */
  readonly ids: number[];
  readonly project: (p: LonLat) => P;
  readonly rings: Map<string, P[]>;
}

/** Project window blocks (sorted by walk position) into a w by h map area. */
function blockPanel(t: CutTrace, ids: number[], rank: Int32Array, h: number): BlockPanel {
  const sorted = [...ids].sort((a, b) => rank[a]! - rank[b]!);
  const blocks: Block[] = sorted.map((b) => t.blocks[b]!);
  // Each ring as its own polygon: projectWindow keeps the largest, which is the outer ring.
  const polys = new Map<string, BlockPolygons>(blocks.map((b) => [b.geoid, b.rings.map((r) => [r])]));
  const { project, rings } = projectWindow(blocks, polys, { w: W, h });
  for (const b of blocks) if (!rings.has(b.geoid)) throw new DataError(`${t.abbr}: block ${b.geoid} has no outline`);
  return { ids: sorted, project: (p) => project(p), rings };
}

const blockList = (t: CutTrace, panel: BlockPanel, side?: (b: number) => 0 | 1): RuleBlock[] =>
  panel.ids.map((b, i) => {
    const blk = t.blocks[b]!;
    const out: RuleBlock = { id: `b${i}`, geoid: blk.geoid, pop: blk.pop, ring: panel.rings.get(blk.geoid)! };
    if (side) out.side = side(b);
    return out;
  });

/** A guide line's spans as panel lines clipped to the map area; ids `id`, `id-1`, ... */
function guideLines(spans: CandidateTrace['passes'][number]['spans'], project: (p: LonLat) => P, h: number, id: string, tag = 'guide'): Line[] {
  const out: Line[] = [];
  for (const [a, b] of spans) {
    const c = clip(project(a), project(b), W, h);
    if (c) out.push({ id: out.length ? `${id}-${out.length}` : id, pts: c.map(round1), tag });
  }
  if (!out.length) throw new DataError('the guide line misses the window');
  return out;
}

const ids = (xs: readonly { id: string }[]): string[] => xs.map((x) => x.id);

/** The window shared by cut.order and cut.measure: the blocks nearest the middle of the walk's guide line. */
async function orderWindow(ctx: ExtractContext) {
  const t = await cutTrace(ctx, 'CO', CO_CUT);
  const tr = t.traces[0]!;
  const rank = ranks(t, tr);
  const walk = tr.passes[0]!;
  const near = nearest(t, middleOf(walk.spans), WINDOW);
  return { t, tr, rank, walk, near };
}

/** cut.order: blocks are ordered by how far their internal points sit across the line, GEOID breaking ties. */
export async function cutOrderCase(ctx: ExtractContext): Promise<RuleCase> {
  const { t, tr, rank, walk, near } = await orderWindow(ctx);
  const MAP_H = 150, AXIS_Y = 172;
  const panel = blockPanel(t, near, rank, MAP_H);
  const blocks = blockList(t, panel);
  const guide = guideLines(walk.spans, panel.project, MAP_H, 'guide');
  const [ga, gb] = guide[0]!.pts as [P, P];
  const points: Line[] = panel.ids.map((b, i) => ({ id: `p${i}`, pts: dot(panel.project(t.blocks[b]!.point)), tag: 'point' }));
  const ticks: Line[] = panel.ids.map((b, i) => {
    const p = panel.project(t.blocks[b]!.point);
    return { id: `t${i}`, pts: [round1(p), round1(foot(p, ga, gb))], tag: 'tick' };
  });
  const span = (W - 32) / (panel.ids.length - 1);
  const onAxis = points.map((p, i) => ({ id: p.id, to: dot([16 + i * span, AXIS_Y]) }));
  const axis: Line = { id: 'axis', pts: [[16, AXIS_Y], [W - 16, AXIS_Y]], tag: 'axis' };
  const labels: Label[] = [
    { id: 'early', x: 40, y: 192, text: 'earlier' },
    { id: 'late', x: W - 40, y: 192, text: 'later' },
  ];
  const lowWalk = new Set(walk.walkLow);
  const sides = Object.fromEntries(panel.ids.map((b, i) => [`b${i}`, lowWalk.has(b) ? 'low' : 'high']));
  const nLow = panel.ids.filter((b) => lowWalk.has(b)).length;

  // Ties: the generator's own key for this direction, compared along the walk.
  const th = (t.k * 180 * (Math.PI / 180)) / t.split.angleCount;
  const nx = cos(th), ny = -sin(th);
  const key = (b: number) => t.split.px[b]! * nx + t.split.py[b]! * ny;
  let ties = 0;
  for (let i = 1; i < tr.order.length; i++) if (key(tr.order[i]!) === key(tr.order[i - 1]!)) ties++;
  const m = tr.order.length;
  const rs = panel.ids.map((b) => rank[b]!);

  const B = ids(blocks), G = ids(guide), Pt = ids(points), T = ids(ticks);
  const onLine = [...B, ...G, ...Pt, 'axis', 'early', 'late'];
  return {
    id: 'cut.order',
    state: t.abbr,
    stateName: nameOf(t.abbr),
    source: { cut: t.cut.order, angleDeg: t.cut.angleDeg },
    link: { state: t.abbr, cut: t.cut.order },
    view: { w: W, h: 200 },
    blocks,
    lines: [...guide, ...ticks, axis, ...points],
    labels,
    steps: [
      { caption: `Cut ${t.cut.order} in ${nameOf(t.abbr)} splits a piece of ${whole(m)} blocks. These are the ${blocks.length} blocks nearest the middle of its line.`, show: [...B, ...G] },
      { caption: 'Each block has an internal point, a spot inside it that the Census Bureau publishes.', show: [...B, ...G, ...Pt] },
      { caption: 'What orders the blocks is how far each point sits across the line, measured at right angles to it.', show: [...B, ...G, ...Pt, ...T] },
      {
        caption: `Sorted by that distance, these ${blocks.length} line up like this. In the full walk they fall between places ${whole(Math.min(...rs) + 1)} and ${whole(Math.max(...rs) + 1)}.`,
        show: onLine,
        tween: onAxis,
      },
      {
        caption: `The walk adds up people in this order. ${nLow} of these blocks come before it stops and join the first side; the other ${blocks.length - nLow} start the second side.`,
        show: onLine,
        set: sides,
      },
      {
        caption: ties === 0
          ? `No two of the ${whole(m)} blocks sit at exactly the same distance. If two did, the one with the smaller GEOID would come first.`
          : `${whole(ties)} times in this piece, two blocks sit at exactly the same distance. Each such pair is taken in GEOID order.`,
        show: onLine,
      },
    ],
  };
}

/** One border edge of a cut's final sides: an edge with a first-side block on one hand and a second-side block on the other. */
export interface BorderEdge {
  readonly a: LonLat;
  readonly b: LonLat;
  /** Blocks along the edge (usually two). */
  readonly blocks: Int32Array;
  /** Great-circle length, counted once per first-side and second-side pair along it (as the generator counts it). */
  readonly lengthM: number;
}

/** Every border edge of a traced candidate's final sides, in the topology's edge order. */
export function borderEdges(t: CutTrace, tr: CandidateTrace): BorderEdge[] {
  const side = new Int8Array(t.blocks.length).fill(-1);
  for (const b of tr.low) side[b] = 0;
  for (const b of tr.high) side[b] = 1;
  const out: BorderEdge[] = [];
  forEachEdge(t.topo, (a, b, blocks) => {
    let lo = 0, hi = 0;
    for (const x of blocks) { if (side[x] === 0) lo++; else if (side[x] === 1) hi++; }
    if (lo && hi) out.push({ a, b, blocks: Int32Array.from(blocks), lengthM: greatCircleDistance(a, b) * lo * hi });
  });
  return out;
}

/** cut.measure: the border's length is the total of the block edges with one side on each hand. */
export async function cutMeasureCase(ctx: ExtractContext): Promise<RuleCase> {
  const { t, tr, rank, walk, near } = await orderWindow(ctx);
  const MAP_H = 164;
  const panel = blockPanel(t, near, rank, MAP_H);
  const low = new Set(tr.low);
  const blocks = blockList(t, panel, (b) => (low.has(b) ? 0 : 1));
  const edges = borderEdges(t, tr);
  const total = edges.reduce((s, e) => s + e.lengthM, 0);
  if (Math.round(total) !== Math.round(tr.lengthM)) {
    throw new DataError(`${t.abbr} cut ${t.cut.order}: border edges add to ${total} m, the generator says ${tr.lengthM} m`);
  }
  // Edges in view, ordered along the line.
  const inView = new Set(panel.ids);
  const [ga, gb] = guideLines(walk.spans, panel.project, MAP_H, 'g')[0]!.pts as [P, P];
  const along = (p: P) => (p[0] - ga[0]) * (gb[0] - ga[0]) + (p[1] - ga[1]) * (gb[1] - ga[1]);
  const shown = edges
    // Only edges between two drawn blocks, so each one visibly separates the two shades.
    .filter((e) => e.blocks.every((b) => inView.has(b)))
    .map((e) => ({ e, pa: panel.project(e.a), pb: panel.project(e.b) }))
    .sort((p, q) => along([(p.pa[0] + p.pb[0]) / 2, (p.pa[1] + p.pb[1]) / 2]) - along([(q.pa[0] + q.pb[0]) / 2, (q.pa[1] + q.pb[1]) / 2]));
  if (shown.length < 3) throw new DataError(`${t.abbr} cut ${t.cut.order}: too few border edges in the window`);
  const lines: Line[] = shown.map((s, i) => ({ id: `e${i}`, pts: [round1(s.pa), round1(s.pb)], tag: 'border' }));
  const size = Math.ceil(shown.length / 3);
  const groups = [0, 1, 2].map((g) => lines.slice(g * size, (g + 1) * size)).filter((g) => g.length);
  let run = 0;
  const sums = groups.map((g, gi) => {
    for (let i = gi * size; i < gi * size + g.length; i++) run += shown[i]!.e.lengthM;
    return run;
  });
  const lenTotal = Math.round(tr.lengthM);
  const labels: Label[] = [
    ...sums.map((s, i): Label => ({ id: `sum${i + 1}`, x: W / 2, y: 182, text: `${whole(Math.round(s))} m in view` })),
    { id: 'total', x: W / 2, y: 182, text: `${whole(lenTotal)} m in all`, tag: 'total' },
  ];
  const B = ids(blocks);
  const upTo = (g: number) => groups.slice(0, g + 1).flatMap(ids);
  const counts = groups.map((g) => g.length);
  const captions = [
    `The border is every block edge with a first-side block on one hand and a second-side block on the other. These ${counts[0]} edges measure ${whole(Math.round(sums[0]!))} m.`,
    `Adding the next ${counts[1]} edges brings it to ${whole(Math.round(sums[1] ?? 0))} m.`,
    `All ${shown.length} border edges in view add up to ${whole(Math.round(sums.at(-1)!))} m, each measured along the surface of the Earth.`,
  ];
  return {
    id: 'cut.measure',
    state: t.abbr,
    stateName: nameOf(t.abbr),
    source: { cut: t.cut.order, angleDeg: t.cut.angleDeg },
    link: { state: t.abbr, cut: t.cut.order },
    view: { w: W, h: 196 },
    blocks,
    lines,
    labels,
    steps: [
      { caption: `Cut ${t.cut.order} in ${nameOf(t.abbr)}, near the middle of its line. Every block is now on the first side or the second, shaded by side.`, show: B },
      ...groups.map((_, g) => ({
        caption: g === groups.length - 1 ? captions[2]! : captions[g]!,
        show: [...B, ...upTo(g), `sum${g + 1}`],
      })),
      {
        caption: `Along the whole line, ${whole(edges.length)} such edges add up to ${whole(lenTotal)} m. That is the length of cut ${t.cut.order}'s border.`,
        show: [...B, ...upTo(groups.length - 1), 'total'],
      },
    ],
  };
}

/** cut.walk-stop: the walk stops at the block that reaches the share; it joins the first side only if that is strictly closer. */
export async function cutWalkStopCase(ctx: ExtractContext): Promise<RuleCase> {
  const t = await cutTrace(ctx, 'CO', CO_CUT);
  const tr = t.traces[0]!;
  const walk = tr.passes[0]!;
  const m = tr.order.length;
  // The generator's own stopping rule, over the traced order (rank as the key keeps that order exactly).
  const pops = Float64Array.from(tr.order, (b) => t.blocks[b]!.pop);
  const count = selectLow(Float64Array.from({ length: m }, (_, i) => i), Int32Array.from(tr.order), pops, new Int32Array(m), walk.target);
  if (count !== walk.walkLow.length) throw new DataError(`${t.abbr} cut ${t.cut.order}: walk stop ${count} does not match the trace (${walk.walkLow.length})`);
  const sum = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += pops[i]!; return s; };
  const joins = sum(count) >= walk.target;
  const crossing = joins ? count - 1 : count;
  const before = sum(crossing), after = sum(crossing + 1), share = walk.target;
  const cross = tr.order[crossing]!;
  const rank = ranks(t, tr);

  const MAP_H = 150, BAR_Y = 180;
  const panel = blockPanel(t, nearest(t, t.blocks[cross]!.point, WINDOW), rank, MAP_H);
  const blocks = blockList(t, panel);
  const crossId = `b${panel.ids.indexOf(cross)}`;
  const guide = guideLines(walk.spans, panel.project, MAP_H, 'guide');
  const reach = Math.max(share - before, after - share) * 1.25;
  const x = (v: number) => 16 + ((v - (share - reach)) / (2 * reach)) * (W - 32);
  const lines: Line[] = [
    ...guide,
    { id: 'cp', pts: dot(panel.project(t.blocks[cross]!.point)), tag: 'point' },
    { id: 'track', pts: [[16, BAR_Y], [W - 16, BAR_Y]], tag: 'track' },
    { id: 'fill', pts: [[16, BAR_Y], round1([x(before), BAR_Y])], tag: 'fill' },
    { id: 'mark', pts: [round1([x(share), BAR_Y - 9]), round1([x(share), BAR_Y + 9])], tag: 'mark' },
  ];
  const labels: Label[] = [
    { id: 'share', x: Math.round(x(share)), y: BAR_Y - 14, text: `share ${people(share)}`, tag: 'share' },
    { id: 'before', x: Math.round(x(before)), y: BAR_Y + 22, text: whole(before) },
    { id: 'after', x: Math.round(x(after)), y: BAR_Y + 22, text: whole(after) },
  ];
  const walked = Object.fromEntries(panel.ids.flatMap((b, i) => (rank[b]! < crossing ? [[`b${i}`, 'low']] : [])));
  const settled = Object.fromEntries(panel.ids.map((b, i) => [`b${i}`, rank[b]! < crossing || (b === cross && joins) ? 'low' : 'high']));
  const B = ids(blocks), bar = ['track', 'fill', 'mark', 'share', 'before'];
  const short = people(share - before), over = people(after - share);
  return {
    id: 'cut.walk-stop',
    state: t.abbr,
    stateName: nameOf(t.abbr),
    source: { cut: t.cut.order, angleDeg: t.cut.angleDeg },
    link: { state: t.abbr, cut: t.cut.order },
    view: { w: W, h: 210 },
    blocks,
    lines,
    labels,
    steps: [
      {
        caption: `Cut ${t.cut.order} in ${nameOf(t.abbr)}: the first side's share is ${people(share)} people. Walking in order, the first ${whole(crossing)} blocks add up to ${whole(before)}, still short.`,
        show: [...B, ...bar],
        set: walked,
      },
      { caption: `Next in the walk is this block, with ${whole(pops[crossing]!)} people.`, show: [...B, ...bar, 'cp'], set: { [crossId]: 'hot' } },
      {
        caption: `With it the total is ${whole(after)}, ${after > share ? 'past' : 'exactly'} the share, so the walk stops at this block.`,
        show: [...B, ...bar, 'cp', 'after'],
        tween: [{ id: 'fill', to: [[16, BAR_Y], round1([x(after), BAR_Y])] }],
      },
      {
        caption: `Before it the total is ${short} short of the share; after it, ${over} over. ${joins ? 'After is strictly closer, so the block joins the first side.' : 'After is not strictly closer, so the block starts the second side.'}`,
        show: [...B, ...bar, 'cp', 'after'],
        set: settled,
      },
      {
        caption: 'The guide line on the map sits halfway between the last block of the first side and the first block of the second, measured across the line.',
        show: [...B, ...bar, 'cp', 'after', ...ids(guide)],
      },
    ],
  };
}

/** cut.both-ways: with an odd seat count, each direction is tried with the smaller share on each side. */
export async function cutBothWaysCase(ctx: ExtractContext): Promise<RuleCase> {
  const abbr = 'AL';
  const out = await ctx.state(abbr);
  const cut = out.cutStats.cuts[0];
  if (!cut) throw new DataError(`${abbr}: no cuts in cut-stats.json`);
  const a = Math.floor(cut.seats / 2), b = cut.seats - a;
  if (a === b) throw new DataError(`${abbr}: cut 1 has an even seat count`);
  const t = await cutTrace(ctx, abbr, cut.order, [a, b]);
  const { fields } = out.candidates;
  const kAt = fields.indexOf('k'), lowAt = fields.indexOf('lowSeats'), lenAt = fields.indexOf('lengthM');
  const len = (low: number): number => {
    const tr = t.traces.find((x) => x.lowSeats === low)!;
    const row = out.candidates.cuts[0]!.find((r) => r[kAt] === t.k && r[lowAt] === low);
    if (!row || row[lenAt] !== Math.round(tr.lengthM)) throw new DataError(`${abbr} cut 1: traced length for ${low} seats does not match candidates.json`);
    return row[lenAt]!;
  };
  const lens = new Map([[a, len(a)], [b, len(b)]]);
  const shorter = lens.get(a)! <= lens.get(b)! ? a : b, longer = shorter === a ? b : a;
  if (shorter !== t.result.lowSeats) throw new DataError(`${abbr} cut 1: the shorter way is not the one the cut used`);

  const outline = await stateOutline(ctx.cfg.rawDir, abbr, 120);
  const proj = (p: LonLat) => t.split.proj.forward(p);
  const H = 200, PAD = 10;
  const toPanel = fit(outline.map(proj), W, H, PAD);
  const at = (p: LonLat): P => toPanel(proj(p));
  const lines: Line[] = [{ id: 'outline', pts: [...outline, outline[0]!].map((p) => round1(at(p))), tag: 'outline' }];
  const labels: Label[] = [];
  const centroid = (bs: Int32Array): P => {
    let sx = 0, sy = 0;
    for (const x of bs) { const p = at(t.blocks[x]!.point); sx += p[0]; sy += p[1]; }
    return [sx / bs.length, sy / bs.length];
  };
  const where = (lo: P, hi: P): string => {
    const dx = lo[0] - hi[0], dy = lo[1] - hi[1];
    return Math.abs(dy) >= Math.abs(dx) ? (dy < 0 ? 'north' : 'south') : (dx > 0 ? 'east' : 'west');
  };
  /** Where the first side lies for each way of splitting, and the opposite direction. */
  const first = new Map<number, string>();
  const opposite: Record<string, string> = { north: 'south', south: 'north', east: 'west', west: 'east' };
  const lineIds = new Map<number, string[]>();
  const middle = (tr: CandidateTrace): P => {
    const [p, q] = tr.passes.at(-1)!.spans[0]!.map(at) as [P, P];
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  };
  for (const tr of t.traces) {
    const s = tr.lowSeats;
    const spans = tr.passes.at(-1)!.spans.map(([p, q]) => [at(p), at(q)] as const);
    // The length sits on the side of its line away from the other line.
    const mid = middle(tr), other = middle(t.traces.find((x) => x !== tr)!);
    const own = spans.map(([p, q], i): Line => ({ id: i ? `line${s}-${i}` : `line${s}`, pts: [round1(p), round1(q)], tag: 'cut' }));
    lines.push(...own);
    lineIds.set(s, ids(own));
    const lo = centroid(tr.low), hi = centroid(tr.high);
    first.set(s, where(lo, hi));
    labels.push(
      { id: `s${s}a`, x: Math.round(lo[0]), y: Math.round(lo[1]), text: `${s} seats` },
      { id: `s${s}b`, x: Math.round(hi[0]), y: Math.round(hi[1]), text: `${cut.seats - s} seats` },
      { id: `len${s}`, x: Math.round(mid[0]), y: Math.round(mid[1] + (other[1] < mid[1] ? 16 : -6)), text: `${whole(lens.get(s)!)} m`, tag: 'length' },
    );
  }
  const L = (s: number) => lineIds.get(s)!;
  const mark = (s: number, v: string) => Object.fromEntries(L(s).map((id) => [id, v]));
  return {
    id: 'cut.both-ways',
    state: abbr,
    stateName: nameOf(abbr),
    source: { cut: cut.order, angleDeg: cut.angleDeg },
    link: { state: abbr, cut: cut.order },
    view: { w: W, h: H },
    lines,
    labels,
    steps: [
      { caption: `${nameOf(abbr)} has ${cut.seats} seats, so its first cut splits them ${a} and ${b}. Take the direction cut 1 used, ${cut.angleDeg.toFixed(1)}° from north-south.`, show: ['outline'] },
      {
        caption: `First with the ${a} seats ${first.get(a)} of the line and ${b} ${opposite[first.get(a)!]}: the line falls here, and its border is ${whole(lens.get(a)!)} m long.`,
        show: ['outline', ...L(a), `s${a}a`, `s${a}b`, `len${a}`],
      },
      {
        caption: `Then the same direction with the ${a} seats ${opposite[first.get(b)!]} of the line and ${b} ${first.get(b)}: the line moves, and its border is ${whole(lens.get(b)!)} m long.`,
        show: ['outline', ...L(a), ...L(b), `s${b}a`, `s${b}b`, `len${b}`],
        set: mark(a, 'dim'),
      },
      {
        caption: `The shorter way is kept, with the ${shorter} seats ${first.get(shorter)} of the line: ${whole(lens.get(shorter)!)} m against ${whole(lens.get(longer)!)} m.`,
        show: ['outline', ...L(a), ...L(b), `len${shorter}`],
        set: { ...mark(shorter, 'kept'), ...mark(longer, 'dim') },
      },
    ],
  };
}

/** cut.globe: a straight line is a great circle, straight in the gnomonic projection the generator uses. */
export async function cutGlobeCase(ctx: ExtractContext): Promise<RuleCase> {
  const abbr = 'CO';
  const path = join(ctx.cfg.outDir, abbr, 'cuts.geojson');
  let raw: unknown;
  try {
    raw = JSON.parse((await readFile(path, 'utf8')).replace(/^﻿/, ''));
  } catch {
    throw new DataError(`cannot read ${path}`);
  }
  const parsed = CutLinesSchema.safeParse(raw);
  if (!parsed.success) throw new DataError(`${path}: not a cut-lines file`);
  const feature = parsed.data.features.find((f) => f.properties.order === 1);
  if (!feature) throw new DataError(`${path}: no cut 1`);
  let span = feature.geometry.coordinates[0]!;
  for (const s of feature.geometry.coordinates) if (greatCircleDistance(s[0]!, s.at(-1)!) > greatCircleDistance(span[0]!, span.at(-1)!)) span = s;
  const [from, to] = [span[0]!, span.at(-1)!];
  const out = await ctx.state(abbr);
  const cut = out.cutStats.cuts.find((c) => c.order === 1)!;
  const split = await splitContextOf(ctx, abbr);

  const ring = densify(await stateOutline(ctx.cfg.rawDir, abbr, 40), 0.25);
  if (ring.length >= 150) throw new DataError(`${abbr}: outline has ${ring.length} points, over 150`);
  const line = greatCircle(from, to, 16);
  // How far the great circle strays from the straight path between its ends on a plain lon/lat grid.
  const chord = Array.from({ length: 401 }, (_, i): LonLat => [from[0] + ((to[0] - from[0]) * i) / 400, from[1] + ((to[1] - from[1]) * i) / 400]);
  let bow = 0;
  for (const p of line) bow = Math.max(bow, Math.min(...chord.map((q) => greatCircleDistance(p, q))));

  const H = 210, MAP_H = 188, PAD = 12;
  const plain = (p: LonLat): P => [p[0], p[1]];
  const flat = (p: LonLat): P => { const [x, y] = split.proj.forward(p); return [x, y]; };
  const fPlain = fit([...ring, ...line].map(plain), W, MAP_H, PAD);
  const fFlat = fit([...ring, ...line].map(flat), W, MAP_H, PAD);
  const draw = (pts: readonly LonLat[], f: (p: P) => P, g: (p: LonLat) => P): P[] => pts.map((p) => round1(f(g(p))));
  const name = nameOf(abbr);
  return {
    id: 'cut.globe',
    state: abbr,
    stateName: name,
    source: { cut: 1, angleDeg: cut.angleDeg },
    link: { state: abbr, cut: 1 },
    view: { w: W, h: H },
    lines: [
      { id: 'outline', pts: draw(ring, fPlain, plain), tag: 'outline' },
      { id: 'cut', pts: draw(line, fPlain, plain), tag: 'cut' },
    ],
    labels: [
      { id: 'grid', x: W / 2, y: H - 4, text: 'longitude and latitude' },
      { id: 'flat', x: W / 2, y: H - 4, text: `projection centered on ${name}` },
    ],
    steps: [
      {
        caption: `Cut 1 in ${name}, drawn on a plain grid of longitude and latitude. On this grid the line is not quite straight: it bows up to ${(bow / 1000).toFixed(1)} km off the straight path between its ends.`,
        show: ['outline', 'cut', 'grid'],
      },
      {
        caption: `The generator measures directions in a flat projection centered on the state. In it every great circle, the path a plane through the Earth's center traces on the surface, is a straight line.`,
        show: ['outline', 'cut', 'flat'],
        tween: [{ id: 'outline', to: draw(ring, fFlat, flat) }, { id: 'cut', to: draw(line, fFlat, flat) }],
      },
      {
        caption: `Here cut 1 is exactly straight. The state's north and south borders follow lines of latitude, which are not great circles, so in this view they curve.`,
        show: ['outline', 'cut', 'flat'],
      },
    ],
  };
}

/** The one-cut panels (stage 2) drawn on real blocks and lines. */
export const cutCases: readonly CaseBuilder[] = [cutOrderCase, cutMeasureCase, cutWalkStopCase, cutBothWaysCase, cutGlobeCase];
