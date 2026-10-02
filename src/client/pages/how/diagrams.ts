import { formatInt, svg } from '../../shared';
import { BALANCE_EXAMPLE, DIRECTION_EXAMPLE, RECOUNT_EXAMPLE, STRANDED_EXAMPLE, applyTrade, bestTrade, improvement, recountExample, sumOfSquares, type Trade } from './examples';

/**
 * Drawings for the How it works page. Each is a small, exact diagram built
 * from shapes (no pictures), styled by classes only so it renders under a
 * Content-Security-Policy without inline styles. Every diagram carries a
 * title and a description for screen readers; the prose around it says the
 * same thing in full.
 */

type Pt = readonly [number, number];
type Child = SVGElement | null;

let uid = 0;

/** One panel: a fixed 320-unit-wide drawing that scales to its column. */
function panel(height: number, title: string, desc: string, ...children: Child[]): SVGSVGElement {
  return sizedPanel(320, height, title, desc, ...children);
}

/** A panel of any width, for narrower frames that sit three across. */
function sizedPanel(width: number, height: number, title: string, desc: string, ...children: Child[]): SVGSVGElement {
  const id = `strv-dg-${++uid}`;
  return svg(
    'svg',
    { viewBox: `0 0 ${width} ${height}`, class: 'strv-dg', role: 'img', 'aria-labelledby': `${id}-t ${id}-d`, focusable: 'false' },
    svg('title', { id: `${id}-t` }, title),
    svg('desc', { id: `${id}-d` }, desc),
    ...children.filter((c): c is SVGElement => c !== null),
  );
}

const poly = (pts: readonly Pt[], cls: string): SVGElement => svg('polygon', { points: pts.map((p) => p.join(',')).join(' '), class: cls });
const rect = (x: number, y: number, w: number, hgt: number, cls: string): SVGElement => svg('rect', { x, y, width: w, height: hgt, class: cls });
const line = (a: Pt, b: Pt, cls: string): SVGElement => svg('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: cls });
const path = (d: string, cls: string): SVGElement => svg('path', { d, class: cls });
const dot = (p: Pt, cls = 'strv-dg__dot', r = 2.75): SVGElement => svg('circle', { cx: p[0], cy: p[1], r, class: cls });

/** Text, one tspan per line; `anchor` is start, middle or end. */
function text(x: number, y: number, lines: string | readonly string[], cls = 'strv-dg__t', anchor: 'start' | 'middle' | 'end' = 'start'): SVGElement {
  const ls = typeof lines === 'string' ? [lines] : lines;
  return svg(
    'text',
    { x, y, class: cls, 'text-anchor': anchor },
    ls.map((l, i) => svg('tspan', { x, dy: i === 0 ? 0 : '1.2em' }, l)),
  );
}

/** A straight arrow from a to b with a drawn head. */
function arrow(a: Pt, b: Pt, cls = 'strv-dg__arrow'): SVGElement {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const hx = b[0] - ux * 7;
  const hy = b[1] - uy * 7;
  const head = `M${(hx - uy * 4).toFixed(1)},${(hy + ux * 4).toFixed(1)}L${b[0]},${b[1]}L${(hx + uy * 4).toFixed(1)},${(hy - ux * 4).toFixed(1)}`;
  return svg('g', { class: cls }, line(a, [hx, hy], ''), path(head, ''));
}

/** A small numbered tag, like the cut numbers on the map. */
function tag(p: Pt, label: string): SVGElement {
  const w = 10 + label.length * 7;
  return svg('g', { class: 'strv-dg__tag' }, rect(p[0] - w / 2, p[1] - 9, w, 18, ''), text(p[0], p[1] + 4.5, label, 'strv-dg__tag-t', 'middle'));
}

/** The district fills, in the map's order. */
const FILL = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((k) => `strv-dg__d${k}`);

// ---------------------------------------------------------------------------
// (a) What goes in

export function inputsDiagram(): SVGSVGElement {
  const P: Pt[][] = [
    [[16, 24], [78, 20], [134, 28], [196, 22]],
    [[20, 80], [74, 86], [140, 76], [192, 82]],
    [[14, 132], [82, 138], [130, 130], [198, 136]],
    [[18, 188], [76, 184], [138, 190], [194, 186]],
  ];
  const pops = [
    [12, 0, 31],
    [48, 64, 7],
    [0, 22, 95],
  ];
  const cells: SVGElement[] = [];
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      const c = [P[j]![i]!, P[j]![i + 1]!, P[j + 1]![i + 1]!, P[j + 1]![i]!];
      const cx = c.reduce((t, p) => t + p[0], 0) / 4;
      const cy = c.reduce((t, p) => t + p[1], 0) / 4;
      const hot = i === 1 && j === 1;
      cells.push(poly(c, hot ? 'strv-dg__block strv-dg__block--hot' : 'strv-dg__block'));
      cells.push(text(cx, cy - 6, String(pops[j]![i]), 'strv-dg__n', 'middle'));
      cells.push(dot([cx, cy + 6]));
    }
  }
  return panel(
    210,
    'What the generator reads for each census block',
    'Nine census blocks drawn as irregular shapes, each with the number of people counted in it and a dot for its internal point. One block is picked out, with labels for its shape, its 64 people and its internal point.',
    svg('g', null, ...cells),
    line([140, 76], [212, 44], 'strv-dg__leader'),
    text(216, 40, ['Shape', 'on the ground'], 'strv-dg__t'),
    line([116, 104], [212, 106], 'strv-dg__leader'),
    text(216, 102, ['People', 'counted: 64'], 'strv-dg__t'),
    line([108, 114], [212, 164], 'strv-dg__leader'),
    text(216, 160, ['Internal point,', 'for ordering only'], 'strv-dg__t'),
  );
}

// ---------------------------------------------------------------------------
// (b) One cut

export function fanDiagram(): SVGSVGElement {
  const c: Pt = [150, 112];
  const outline: Pt[] = [[40, 54], [120, 26], [214, 36], [262, 84], [250, 168], [176, 196], [86, 186], [34, 130]];
  const lines: SVGElement[] = [];
  for (let k = 0; k < 12; k++) {
    const a = (k * 15 * Math.PI) / 180;
    const dx = Math.sin(a) * 104;
    const dy = -Math.cos(a) * 104;
    lines.push(line([c[0] - dx, c[1] - dy], [c[0] + dx, c[1] + dy], k === 0 ? 'strv-dg__guide strv-dg__guide--ns' : 'strv-dg__guide'));
  }
  return panel(
    224,
    'Guide lines in every direction',
    'The outline of a piece of a state with twelve straight guide lines through it, one every 15 degrees, starting with north-south. The generator tries 1,800 directions, one every 0.1 degrees.',
    poly(outline, 'strv-dg__piece'),
    ...lines,
    text(157, 15, '0°: north-south', 'strv-dg__t strv-dg__t--small'),
    text(278, 120, ['1,800', 'directions,', '12 drawn'], 'strv-dg__t strv-dg__t--small'),
  );
}

/** A grid of square blocks, a guide line, the two sides, and the real border along block edges. */
export function borderDiagram(): SVGSVGElement {
  const x0 = 30;
  const y0 = 20;
  const s = 40;
  const cols = 6;
  const rows = 4;
  // Internal points sit off-center, as real ones do.
  const jitter = [
    [0.4, 0.6], [0.6, 0.3], [0.5, 0.5], [0.3, 0.7], [0.7, 0.4], [0.5, 0.6],
    [0.6, 0.5], [0.4, 0.4], [0.25, 0.55], [0.6, 0.6], [0.45, 0.3], [0.5, 0.5],
    [0.5, 0.3], [0.7, 0.6], [0.6, 0.45], [0.4, 0.5], [0.55, 0.65], [0.35, 0.4],
    [0.3, 0.5], [0.5, 0.7], [0.65, 0.35], [0.45, 0.55], [0.6, 0.4], [0.5, 0.6],
  ];
  // Guide line through (a) and (b); blocks whose internal point is left of it go to the first side.
  const a: Pt = [104, 196];
  const b: Pt = [196, 8];
  const side = (p: Pt): number => Math.sign((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
  const sideOf: number[][] = [];
  const cells: SVGElement[] = [];
  const dots: SVGElement[] = [];
  for (let r = 0; r < rows; r++) {
    sideOf.push([]);
    for (let q = 0; q < cols; q++) {
      const [jx = 0.5, jy = 0.5] = jitter[r * cols + q] ?? [];
      const p: Pt = [x0 + (q + jx) * s, y0 + (r + jy) * s];
      const sd = side(p) < 0 ? 0 : 1;
      sideOf[r]!.push(sd);
      cells.push(rect(x0 + q * s, y0 + r * s, s, s, `strv-dg__block ${FILL[sd === 0 ? 0 : 1]}`));
      dots.push(dot(p));
    }
  }
  // The real border: every block edge with a different side on each hand.
  let d = '';
  for (let r = 0; r < rows; r++) {
    for (let q = 0; q < cols; q++) {
      if (q + 1 < cols && sideOf[r]![q] !== sideOf[r]![q + 1]) d += `M${x0 + (q + 1) * s},${y0 + r * s}v${s}`;
      if (r + 1 < rows && sideOf[r]![q] !== sideOf[r + 1]![q]) d += `M${x0 + q * s},${y0 + (r + 1) * s}h${s}`;
    }
  }
  return panel(
    236,
    'From guide line to real border',
    'A grid of 24 census blocks, each with its internal point. A dashed guide line crosses the grid. Each block goes, whole, to the side its internal point is on, so the real border is a staircase along block edges near the guide line.',
    ...cells,
    path(d, 'strv-dg__border'),
    line(a, b, 'strv-dg__guide strv-dg__guide--chosen'),
    ...dots,
    text(30, 200 + 14, 'Dashed: the guide line.', 'strv-dg__t strv-dg__t--small'),
    text(30, 200 + 30, 'Heavy: the real border, along block edges.', 'strv-dg__t strv-dg__t--small'),
  );
}

/** The example piece for comparing directions: an irregular oval leaning 20° east of north, in a 96-unit cell. */
function directionPiece(cx: number, cy: number): Pt[] {
  const wobble = [1, 0.96, 1.04, 0.98, 1.02, 0.97, 1, 1.03, 0.96, 1.01, 0.99, 1.02];
  const lean = (20 * Math.PI) / 180;
  const u: Pt = [Math.sin(lean), -Math.cos(lean)];
  const v: Pt = [Math.cos(lean), Math.sin(lean)];
  return wobble.map((m, i) => {
    const t = (i * 2 * Math.PI) / wobble.length;
    const a = 46 * Math.cos(t) * m;
    const b = 26 * Math.sin(t) * m;
    return [cx + u[0] * a + v[0] * b, cy + u[1] * a + v[1] * b] as Pt;
  });
}

/** Where a line through `c` in direction `deg` (clockwise from north) leaves the outline on each side. */
export function clipThrough(outline: readonly Pt[], c: Pt, deg: number): [Pt, Pt] {
  const d: Pt = [Math.sin((deg * Math.PI) / 180), -Math.cos((deg * Math.PI) / 180)];
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i]!;
    const q = outline[(i + 1) % outline.length]!;
    const e: Pt = [q[0] - p[0], q[1] - p[1]];
    const den = d[0] * e[1] - d[1] * e[0];
    if (den === 0) continue;
    const w: Pt = [p[0] - c[0], p[1] - c[1]];
    const t = (w[0] * e[1] - w[1] * e[0]) / den;
    const s = (w[0] * d[1] - w[1] * d[0]) / den;
    if (s < 0 || s > 1) continue;
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  return [
    [c[0] + d[0] * lo, c[1] + d[1] * lo],
    [c[0] + d[0] * hi, c[1] + d[1] * hi],
  ];
}

/** Drawn length of each example direction's line, in diagram units (for checking the drawing agrees with its numbers). */
export function directionLengths(): number[] {
  const c: Pt = [48, 50];
  const outline = directionPiece(c[0], c[1]);
  return DIRECTION_EXAMPLE.map(({ angle }) => {
    const [a, b] = clipThrough(outline, c, angle);
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  });
}

/** Three directions for the same piece, each with its border length; the shortest is the one used. */
export function directionsDiagram(): SVGSVGElement {
  const shortest = Math.min(...DIRECTION_EXAMPLE.map((d) => d.km));
  const cells = DIRECTION_EXAMPLE.map(({ angle, km }, i) => {
    const x = 8 + i * 104;
    const c: Pt = [x + 48, 50];
    const outline = directionPiece(c[0], c[1]);
    const [a, b] = clipThrough(outline, c, angle);
    const won = km === shortest;
    return svg(
      'g',
      null,
      poly(outline, 'strv-dg__piece'),
      won ? line(a, b, 'strv-dg__won-case') : null,
      line(a, b, won ? 'strv-dg__won' : 'strv-dg__cand-line'),
      text(c[0], 122, `${angle}°`, 'strv-dg__t strv-dg__t--small', 'middle'),
      text(c[0], 140, `${km} km`, won ? 'strv-dg__t strv-dg__t--strong' : 'strv-dg__t', 'middle'),
      won ? text(c[0], 156, 'Shortest: used', 'strv-dg__t strv-dg__t--small strv-dg__t--strong', 'middle') : null,
    );
  });
  const [a, b, c] = DIRECTION_EXAMPLE;
  return panel(
    166,
    'Three directions compared',
    `The same piece drawn three times, each split by a line in a different direction, with the length of the real border it makes: ${a.angle} degrees, ${a.km} km; ${b.angle} degrees, ${b.km} km; ${c.angle} degrees, ${c.km} km. The shortest, ${shortest} km, is the one used.`,
    ...cells,
  );
}

/** A signed whole number with a true minus sign: +400, −300, 0. */
export function signed(n: number): string {
  return n > 0 ? `+${formatInt(n)}` : n < 0 ? `−${formatInt(-n)}` : '0';
}

/** The balancing example: District 3 is furthest from even; three of its border blocks could move. */
export function balanceChoiceDiagram(): SVGSVGElement {
  const { start, trades } = BALANCE_EXAMPLE;
  const best = bestTrade(start, trades);
  const y0 = 50;
  const s = 40;
  // Columns: District 1 (two), District 3 (three), District 5 (two).
  const cols = [
    { x: 20, d: 0 },
    { x: 60, d: 0 },
    { x: 100, d: 2 },
    { x: 140, d: 2 },
    { x: 180, d: 2 },
    { x: 220, d: 1 },
    { x: 260, d: 1 },
  ];
  // Where each trade's block sits on District 3's border: next to the district it would join.
  const at: Record<string, Pt> = { A: [100, y0], B: [100, y0 + 2 * s], C: [180, y0 + s] };
  const cells: SVGElement[] = [];
  for (let r = 0; r < 3; r++) for (const c of cols) cells.push(rect(c.x, y0 + r * s, s, s, `strv-dg__block ${FILL[c.d]}`));
  const cand = (t: Trade): SVGElement[] => {
    const [x, y] = at[t.id]!;
    const chosen = t === best;
    const toLeft = t.to === 1;
    const from: Pt = toLeft ? [x, y + 20] : [x + s, y + 20];
    const to: Pt = toLeft ? [x - 36, y + 20] : [x + s + 36, y + 20];
    return [
      rect(x, y, s, s, `strv-dg__block ${FILL[2]} ${chosen ? 'strv-dg__move' : 'strv-dg__cand'}`),
      text(x + s / 2, y + 17, t.id, 'strv-dg__n', 'middle'),
      text(x + s / 2, y + 31, formatInt(t.people), 'strv-dg__n', 'middle'),
      arrow(from, to, chosen ? 'strv-dg__arrow strv-dg__arrow--go' : 'strv-dg__arrow strv-dg__arrow--maybe'),
    ];
  };
  const results = trades.map((t, i) =>
    text(
      20,
      196 + i * 18,
      `${t.id}: sum of squares ${formatInt(sumOfSquares(applyTrade(start, t)))}, better by ${formatInt(improvement(start, t))}`,
      t === best ? 'strv-dg__t strv-dg__t--small strv-dg__t--strong' : 'strv-dg__t strv-dg__t--small',
    ),
  );
  const head = (x: number, d: number): SVGElement[] => [
    text(x, 18, `District ${d}`, 'strv-dg__t strv-dg__t--small strv-dg__t--strong', 'middle'),
    text(x, 36, signed(start[d] ?? 0), 'strv-dg__t', 'middle'),
  ];
  return panel(
    262,
    'Choosing the next block to move',
    `Three districts side by side. District 1 is ${formatInt(-start[1]!)} people below an even split, District 3 is ${formatInt(start[3]!)} above, District 5 is ${formatInt(-start[5]!)} below. Three blocks on District 3’s border could move: ${trades.map((t) => `${t.id}, ${formatInt(t.people)} people, to District ${t.to}`).join('; ')}. ${best.id} leaves the state closest to even, so ${best.id} moves.`,
    ...head(60, 1),
    ...head(160, 3),
    ...head(260, 5),
    ...cells,
    line([100, y0], [100, y0 + 3 * s], 'strv-dg__cut'),
    line([220, y0], [220, y0 + 3 * s], 'strv-dg__cut'),
    ...trades.flatMap(cand),
    ...results,
    text(20, 254, 'Solid arrow: the move made. Dashed: passed over.', 'strv-dg__t strv-dg__t--small'),
  );
}

// ---------------------------------------------------------------------------
// (c) Stray pieces and the re-count

/**
 * The re-count in three frames, on one small scene: two columns of West blocks, a large block that
 * straddles the guide line with a small block (the island) inside it, block T above the large block,
 * and the East blocks. Frame 1 places blocks by their centers; frame 2 shows the island cut off from
 * its side; frame 3 has the island joined to the side around it and the line slid so T crosses back.
 * The people come from RECOUNT_EXAMPLE.
 */
export function recountDiagrams(): [SVGSVGElement, SVGSVGElement, SVGSVGElement] {
  const r = recountExample();
  const t = RECOUNT_EXAMPLE.blocks.find((b) => b.name === 'T')!.people;
  const A = `strv-dg__block ${FILL[0]}`;
  const B = `strv-dg__block ${FILL[1]}`;
  // The guide line before and after the re-count, and the island's square inside the large block.
  const x1 = 122;
  const x3 = 107;
  const isl = { x: 126, y: 72, w: 20, h: 26 };
  const island = `M${isl.x},${isl.y}v${isl.h}h${isl.w}v${-isl.h}Z`;
  const scene = (frame: 1 | 2 | 3): SVGElement[] => {
    const out: SVGElement[] = [];
    for (const y of [10, 50, 90, 130]) out.push(rect(10, y, 40, 40, A), rect(50, y, 40, 40, A), rect(150, y, 40, 40, B));
    out.push(rect(90, 10, 30, 40, frame === 3 ? B : A), rect(120, 10, 30, 40, B));
    out.push(rect(90, 130, 30, 40, A), rect(120, 130, 30, 40, B));
    out.push(path(`M90,50H150V130H90Z${island}`, `${A} strv-dg__evenodd`));
    out.push(rect(isl.x, isl.y, isl.w, isl.h, `${frame === 3 ? A : B}${frame === 2 ? ' strv-dg__stray' : ''}`));
    return out;
  };
  // Block centers: the West columns and East column, then T, the block right of T, the two bottom
  // blocks, the large block and the island.
  const centers: Pt[] = [
    ...[30, 70, 170].flatMap((x) => [30, 70, 110, 150].map((y): Pt => [x, y])),
    [112, 38], [135, 30], [100, 150], [133, 150], [104, 112], [136, 91],
  ];
  const labels = (frame: 1 | 2 | 3): SVGElement[] => [
    text(98, 25, String(t), 'strv-dg__n', 'middle'),
    text(isl.x + isl.w / 2, isl.y + 11, String(r.island), 'strv-dg__n', 'middle'),
    ...(frame === 1 ? centers.map((c) => dot(c, 'strv-dg__dot', 2.25)) : []),
  ];
  const foot = (lines: string[], strong: string): SVGElement[] => [
    text(10, 200, lines, 'strv-dg__t strv-dg__t--small'),
    text(10, 200 + lines.length * 14.4, strong, 'strv-dg__t strv-dg__t--small strv-dg__t--strong'),
  ];
  const H = 250;
  const one = sizedPanel(
    200,
    H,
    'Frame 1: blocks placed by their centers',
    `A dashed guide line runs down a small piece. Each block goes, whole, to the side its center dot is on. A large block straddles the line with its center on the left, so it goes left. A small block inside it, holding ${formatInt(r.island)} people, has its center just right of the line, so it goes right. Each side holds ${formatInt(r.firstWalk)} people.`,
    ...scene(1),
    line([x1, 4], [x1, 176], 'strv-dg__guide strv-dg__guide--chosen'),
    ...labels(1),
    ...foot(['1. Each block goes to the', 'side its center is on.'], `Left ${formatInt(r.firstWalk)}, right ${formatInt(r.low + r.high - r.firstWalk)}`),
  );
  const two = sizedPanel(
    200,
    H,
    'Frame 2: an island on the wrong side',
    'The small block is on the right side but surrounded by the large left block, so it is cut off from the rest of the right side: an island. It is outlined in amber.',
    ...scene(2),
    path(`M${x1 - 2},10V50H150V130H120V170${island}`, 'strv-dg__border'),
    ...labels(2),
    ...foot(['2. The small block is cut off', 'from its side: an island.'], `Island: ${formatInt(r.island)} people`),
  );
  const three = sizedPanel(
    200,
    H,
    'Frame 3: the island joins, and the line slides',
    `The island joins the left side around it and stays there. The people are counted again: the left side now has ${formatInt(r.island)} people too many, so the guide line slides a little to the left and block T, with ${formatInt(t)} people, goes to the right side. Each side again holds ${formatInt(r.low)} people.`,
    ...scene(3),
    line([x1, 4], [x1, 176], 'strv-dg__guide'),
    path('M90,10V50H150V130H120V170', 'strv-dg__border'),
    line([x3, 4], [x3, 176], 'strv-dg__guide strv-dg__guide--chosen'),
    arrow([x1, 184], [x3, 184]),
    ...labels(3),
    ...foot(['3. The island joins the left,', 'and the line slides so T', 'crosses back.'], `Left ${formatInt(r.low)}, right ${formatInt(r.high)}`),
  );
  return [one, two, three];
}

/** Two lines for the same U-shaped piece: one strands a big region and has the longer border; the other wins. */
export function strandedDiagrams(): [SVGSVGElement, SVGSVGElement] {
  const { stranded, clean } = STRANDED_EXAMPLE;
  const U = 'M40,40H110V140H210V40H280V200H40Z';
  const A = `strv-dg__block ${FILL[0]}`;
  const B = `strv-dg__block ${FILL[1]}`;
  const left = panel(
    236,
    'A line that strands a big piece',
    `A U-shaped piece. A level guide line crosses both arms. The tip of the left arm, ${formatInt(stranded.people)} people, is cut off and joins the side around it. That is allowed. The line then slides down the right arm so the people still split evenly. Its real border is ${stranded.km} km.`,
    path(U, A),
    rect(210, 40, 70, 88, B),
    rect(40, 40, 70, 60, `${A} strv-dg__stray`),
    line([20, 100], [300, 100], 'strv-dg__guide'),
    line([20, 128], [300, 128], 'strv-dg__guide strv-dg__guide--chosen'),
    path('M210,128H280', 'strv-dg__border'),
    text(75, 74, formatInt(stranded.people), 'strv-dg__n', 'middle'),
    text(160, 176, 'Rest of the piece', 'strv-dg__t strv-dg__t--small', 'middle'),
    text(30, 214, `Cut off: ${formatInt(stranded.people)} people. Allowed.`, 'strv-dg__t strv-dg__t--small'),
    text(30, 230, `Real border: ${stranded.km} km.`, 'strv-dg__t strv-dg__t--small'),
  );
  const right = panel(
    236,
    'A shorter line that strands nothing',
    `The same piece split by a north-south line through the bottom of the U. Nothing is cut off. Its real border is ${clean.km} km, shorter than ${stranded.km} km, so this line is used.`,
    path(U, A),
    path('M160,140H210V40H280V200H160Z', B),
    line([160, 20], [160, 220], 'strv-dg__guide strv-dg__guide--chosen'),
    path('M160,140V200', 'strv-dg__border'),
    text(30, 214, 'Cut off: nobody.', 'strv-dg__t strv-dg__t--small'),
    text(30, 230, `Real border: ${clean.km} km. Shorter: used.`, 'strv-dg__t strv-dg__t--small strv-dg__t--strong'),
  );
  return [left, right];
}

// ---------------------------------------------------------------------------
// (d) Repeat until every piece has one seat

export function recursionDiagram(): SVGSVGElement {
  // Seven seats: 3 | 4, then 1 | 2 and 2 | 2, then 1 | 1 three times. Districts in the order the rule numbers them.
  const districts: [number, number, number, number][] = [
    [20, 20, 120, 60],
    [20, 80, 60, 120],
    [80, 80, 60, 120],
    [140, 20, 80, 90],
    [220, 20, 80, 90],
    [140, 110, 80, 90],
    [220, 110, 80, 90],
  ];
  const colors = [0, 1, 2, 2, 0, 1, 3];
  // Each cut's number sits on its line, clear of the other lines' ends.
  const TAG_AT: Pt[] = [[140, 50], [50, 80], [80, 150], [180, 110], [220, 65], [220, 155]];
  const cuts: [Pt, Pt][] = [
    [[140, 20], [140, 200]],
    [[20, 80], [140, 80]],
    [[80, 80], [80, 200]],
    [[140, 110], [300, 110]],
    [[220, 20], [220, 110]],
    [[220, 110], [220, 200]],
  ];
  return panel(
    224,
    'Seven seats, six cuts',
    'A rectangle standing for a state with seven seats. Cut 1 splits it into 3 and 4 seats. Cut 2 splits the 3 into 1 and 2, cut 3 splits that 2 into 1 and 1. Cut 4 splits the 4 into 2 and 2, and cuts 5 and 6 split each 2. Seven districts, numbered 1 to 7.',
    ...districts.map(([x, y, w, hh], i) => rect(x, y, w, hh, `strv-dg__block ${FILL[colors[i]!]}`)),
    ...cuts.map(([p, q]) => line(p, q, 'strv-dg__cut')),
    ...districts.map(([x, y, w, hh], i) => text(x + w / 2, y + hh / 2 + 6, String(i + 1), 'strv-dg__district', 'middle')),
    ...TAG_AT.map((p, i) => tag(p, String(i + 1))),
    text(160, 218, 'Numbers in boxes: cuts, in order. Bold: districts.', 'strv-dg__t strv-dg__t--small', 'middle'),
  );
}

// ---------------------------------------------------------------------------
// (e) Balancing

interface BalanceCase {
  readonly moved: string;
  readonly aAfter: string;
  readonly bAfter: string;
  readonly gapAfter: string;
  readonly verdict: readonly [string, string];
  readonly spoken: string;
}

/** One candidate move: the grid with the block and its arrow, then the numbers before and after. */
function balancePanel(c: BalanceCase): SVGSVGElement {
  const x0 = 40;
  const y0 = 46;
  const s = 40;
  const cells: SVGElement[] = [];
  for (let r = 0; r < 3; r++) {
    for (let q = 0; q < 6; q++) cells.push(rect(x0 + q * s, y0 + r * s, s, s, `strv-dg__block ${q < 3 ? FILL[0] : FILL[1]}`));
  }
  // The moved block is drawn last so its outline sits on top of its neighbors'.
  cells.push(rect(x0 + 2 * s, y0 + s, s, s, `strv-dg__block ${FILL[0]} strv-dg__move`));
  const bx = x0 + 3 * s;
  const row = (y: number, label: string, before: string, after: string, strong = false): SVGElement[] => {
    const cls = strong ? 'strv-dg__t strv-dg__t--strong' : 'strv-dg__t';
    return [text(20, y, label, cls), text(224, y, before, cls, 'end'), text(300, y, after, cls, 'end')];
  };
  return panel(
    312,
    `Move the ${c.moved}-person block`,
    `Districts A and B before and after moving a block of ${c.moved} people from A to B. A goes from 10,240 to ${c.aAfter}, B from 9,760 to ${c.bAfter}. The gap between them goes from 480 to ${c.gapAfter}. ${c.spoken}`,
    text(160, 16, `Move the ${c.moved}-person block`, 'strv-dg__t strv-dg__t--strong', 'middle'),
    text(x0 + 1.5 * s, 36, 'District A', 'strv-dg__t strv-dg__t--small strv-dg__t--strong', 'middle'),
    text(x0 + 4.5 * s, 36, 'District B', 'strv-dg__t strv-dg__t--small strv-dg__t--strong', 'middle'),
    ...cells,
    line([bx, y0], [bx, y0 + 3 * s], 'strv-dg__cut'),
    text(x0 + 2.5 * s, y0 + 1.5 * s + 14, c.moved, 'strv-dg__n', 'middle'),
    arrow([x0 + 2.5 * s - 12, y0 + 1.5 * s - 6], [bx + 38, y0 + 1.5 * s - 6], 'strv-dg__arrow strv-dg__arrow--go'),
    text(224, 194, 'Before', 'strv-dg__t strv-dg__t--small strv-dg__t--strong', 'end'),
    text(300, 194, 'After', 'strv-dg__t strv-dg__t--small strv-dg__t--strong', 'end'),
    ...row(214, 'District A', '10,240', c.aAfter),
    ...row(234, 'District B', '9,760', c.bAfter),
    line([20, 244], [300, 244], 'strv-dg__leader'),
    ...row(264, 'Gap', '480', c.gapAfter, true),
    text(20, 290, [c.verdict[0], c.verdict[1]], 'strv-dg__t strv-dg__t--strong'),
  );
}

/** Both candidate moves from the same two districts, side by side. */
export function balanceDiagrams(): [SVGSVGElement, SVGSVGElement] {
  return [
    balancePanel({ moved: '180', aAfter: '10,060', bAfter: '9,940', gapAfter: '120', verdict: ['Gap 480 → 120:', 'closer to equal, allowed'], spoken: 'The gap gets smaller, so the move is allowed.' }),
    balancePanel({ moved: '600', aAfter: '9,640', bAfter: '10,360', gapAfter: '720', verdict: ['Gap 480 → 720:', 'B is now too big, not allowed'], spoken: 'The gap gets bigger, so the move is not allowed.' }),
  ];
}

// ---------------------------------------------------------------------------
// (f) Same data, same map

export function fingerprintDiagram(): SVGSVGElement {
  const box = (x: number, y: number, w: number, hh: number, lines: string[], strong = false): SVGElement[] => [
    rect(x, y, w, hh, strong ? 'strv-dg__box strv-dg__box--ink' : 'strv-dg__box'),
    text(x + w / 2, y + hh / 2 - (lines.length - 1) * 7.5 + 4.5, lines, strong ? 'strv-dg__t strv-dg__t--on-ink' : 'strv-dg__t strv-dg__t--small', 'middle'),
  ];
  // The fingerprint block: 64 characters as four rows of four groups, drawn as glyph cells.
  const glyphs: SVGElement[] = [];
  for (let r = 0; r < 4; r++) {
    for (let g = 0; g < 4; g++) {
      for (let c = 0; c < 4; c++) glyphs.push(rect(98 + g * 32 + c * 7, 214 + r * 11, 5, 7, 'strv-dg__glyph'));
    }
  }
  return panel(
    268,
    'Same inputs, same fingerprint',
    'Two inputs, the 2020 Census block file and the angle step of the guide lines, go into the generator, which has no random numbers. It writes the assignment file, every block and its district. The SHA-256 hash of that file is the map’s fingerprint, 64 characters long. Any computer gets the same file.',
    ...box(30, 10, 120, 44, ['2020 Census', 'block file']),
    ...box(170, 10, 120, 44, ['Guide lines', 'every 0.1°']),
    arrow([90, 54], [130, 80]),
    arrow([230, 54], [190, 80]),
    ...box(40, 82, 240, 40, ['The rule: no random numbers'], true),
    arrow([160, 122], [160, 140]),
    ...box(70, 142, 180, 40, ['assignment.csv:', 'every block, its district']),
    arrow([160, 182], [160, 204]),
    rect(90, 206, 140, 50, 'strv-dg__digest'),
    ...glyphs,
    text(240, 222, 'SHA-256:', 'strv-dg__t strv-dg__t--small'),
    text(240, 238, 'the map’s', 'strv-dg__t strv-dg__t--small'),
    text(240, 254, 'fingerprint', 'strv-dg__t strv-dg__t--small'),
  );
}

// ---------------------------------------------------------------------------
// (g) Data sources

export function sourcesDiagram(): SVGSVGElement {
  const solid = (x: number, y: number, w: number, hh: number, lines: string[]): SVGElement[] => [rect(x, y, w, hh, 'strv-dg__box'), text(x + w / 2, y + hh / 2 - (lines.length - 1) * 7.5 + 4.5, lines, 'strv-dg__t strv-dg__t--small', 'middle')];
  const dashed = (x: number, y: number, w: number, hh: number, lines: string[]): SVGElement[] => [rect(x, y, w, hh, 'strv-dg__box strv-dg__box--dashed'), text(x + w / 2, y + hh / 2 - (lines.length - 1) * 7.5 + 4.5, lines, 'strv-dg__t strv-dg__t--small', 'middle')];
  return panel(
    300,
    'Which data draws the map and which is only shown',
    'Left column, solid: the 2020 Census blocks go into the generator, which writes the districts and their numbers. Right column, dashed: the 119th Congress districts, state outlines and county names, and the Census geocoder are used only by the viewer, for display. Both columns feed the viewer; only the left one draws districts.',
    text(80, 16, 'Draws the map', 'strv-dg__t strv-dg__t--strong', 'middle'),
    text(240, 16, 'Shown only', 'strv-dg__t strv-dg__t--strong', 'middle'),
    ...solid(10, 28, 140, 48, ['2020 Census blocks:', 'people, shapes, points']),
    arrow([80, 76], [80, 98]),
    ...solid(10, 100, 140, 40, ['The generator']),
    arrow([80, 140], [80, 162]),
    ...solid(10, 164, 140, 48, ['Districts and', 'their numbers']),
    ...dashed(170, 28, 140, 48, ['119th Congress', 'districts']),
    ...dashed(170, 96, 140, 48, ['State outlines,', 'county names']),
    ...dashed(170, 164, 140, 48, ['Census geocoder', '(address search)']),
    arrow([80, 212], [80, 244]),
    path('M240,76V86M240,144V154M240,212V244', 'strv-dg__flow strv-dg__flow--dashed'),
    path('M233.5,237L240,244L246.5,237', 'strv-dg__flow'),
    rect(10, 246, 300, 40, 'strv-dg__box strv-dg__box--ink'),
    text(160, 271, 'This viewer', 'strv-dg__t strv-dg__t--on-ink', 'middle'),
  );
}
