/** A label's box on screen: its center and its size, in pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Bounds {
  w: number;
  h: number;
}

/** True when two boxes overlap, or come closer than `gap` pixels. */
export function boxesOverlap(a: Box, b: Box, gap = 0): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gap && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + gap;
}

/** True when the whole box sits inside the frame, with `margin` pixels to spare. */
export function boxInside(box: Box, bounds: Bounds, margin = 2): boolean {
  return box.x - box.w / 2 >= margin && box.x + box.w / 2 <= bounds.w - margin && box.y - box.h / 2 >= margin && box.y + box.h / 2 <= bounds.h - margin;
}

const clearOf = (box: Box, obstacles: readonly Box[], gap: number): boolean => obstacles.every((o) => !boxesOverlap(box, o, gap));

/**
 * Chooses where a label sits among candidate spots (in order of preference),
 * for a label that has to stay on a line: the first spot that is inside the
 * frame and clear of every obstacle. Returns null when none is clear.
 */
export function firstClearSpot(candidates: readonly { x: number; y: number }[], size: { w: number; h: number }, obstacles: readonly Box[], bounds: Bounds, gap = 2): number | null {
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const box = { x: c.x, y: c.y, w: size.w, h: size.h };
    if (boxInside(box, bounds) && clearOf(box, obstacles, gap)) return i;
  }
  return null;
}

const RING_ANGLES = [0, 180, 90, 270, 45, 225, 135, 315, 22, 202, 112, 292];

/**
 * For a label that may move freely: how far to shift it so it clears every
 * obstacle. (0, 0) when its own spot is free; otherwise the nearest free spot
 * on rings around it; null when the frame is too crowded for any.
 */
export function findOffset(origin: { x: number; y: number }, size: { w: number; h: number }, obstacles: readonly Box[], bounds: Bounds, gap = 0, radii: readonly number[] = [30, 50, 70, 90, 110]): { dx: number; dy: number } | null {
  const free = (x: number, y: number): boolean => clearOf({ x, y, w: size.w, h: size.h }, obstacles, gap);
  if (free(origin.x, origin.y)) return { dx: 0, dy: 0 };
  for (const r of radii) {
    for (const deg of RING_ANGLES) {
      const dx = Math.round(Math.cos((deg * Math.PI) / 180) * r);
      const dy = Math.round(Math.sin((deg * Math.PI) / 180) * r);
      const box = { x: origin.x + dx, y: origin.y + dy, w: size.w, h: size.h };
      if (boxInside(box, bounds) && free(box.x, box.y)) return { dx, dy };
    }
  }
  return null;
}

/** Like findOffset, but stays put (0, 0) when nothing is free. */
export function offsetToClear(origin: { x: number; y: number }, size: { w: number; h: number }, obstacles: readonly Box[], bounds: Bounds, gap = 0, radii?: readonly number[]): { dx: number; dy: number } {
  return findOffset(origin, size, obstacles, bounds, gap, radii) ?? { dx: 0, dy: 0 };
}

/** Groups of point indexes that sit within `maxDist` pixels of each other, directly or through a chain. */
export function clusterPoints(points: readonly { x: number; y: number }[], maxDist: number): number[][] {
  const parent = points.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (Math.hypot(points[i]!.x - points[j]!.x, points[i]!.y - points[j]!.y) <= maxDist) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, number[]>();
  points.forEach((_, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });
  return [...groups.values()];
}

/* ---------- District numbers that stay with their own district ---------- */

export interface Pt {
  x: number;
  y: number;
}

/** A district's outline on screen: polygons, each an outer ring then holes, in pixels. */
export interface Shape {
  parts: Pt[][][];
  /** [minX, minY, maxX, maxY] of the outer rings. */
  bbox: [number, number, number, number];
}

export function makeShape(parts: Pt[][][]): Shape {
  const bbox: Shape['bbox'] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    for (const p of part[0] ?? []) {
      if (p.x < bbox[0]) bbox[0] = p.x;
      if (p.y < bbox[1]) bbox[1] = p.y;
      if (p.x > bbox[2]) bbox[2] = p.x;
      if (p.y > bbox[3]) bbox[3] = p.y;
    }
  }
  return { parts, bbox };
}

function inRing(p: Pt, ring: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function pointInShape(p: Pt, shape: Shape): boolean {
  const [x0, y0, x1, y1] = shape.bbox;
  if (p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) return false;
  for (const part of shape.parts) {
    const outer = part[0];
    if (!outer || !inRing(p, outer)) continue;
    let inHole = false;
    for (let k = 1; k < part.length; k++) {
      if (inRing(p, part[k]!)) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

/** The corners, edge midpoints and center of a box. */
function boxSamples(b: Box): Pt[] {
  const out: Pt[] = [];
  for (const dx of [-b.w / 2, 0, b.w / 2]) for (const dy of [-b.h / 2, 0, b.h / 2]) out.push({ x: b.x + dx, y: b.y + dy });
  return out;
}

function bboxHitsBox(bb: Shape['bbox'], b: Box): boolean {
  return bb[0] <= b.x + b.w / 2 && bb[2] >= b.x - b.w / 2 && bb[1] <= b.y + b.h / 2 && bb[3] >= b.y - b.h / 2;
}

/** True when an outline vertex lies inside the box, which means the boundary passes through it. */
function vertexInBox(shape: Shape, b: Box): boolean {
  if (!bboxHitsBox(shape.bbox, b)) return false;
  for (const part of shape.parts) {
    for (const ring of part) {
      for (const p of ring) if (Math.abs(p.x - b.x) <= b.w / 2 && Math.abs(p.y - b.y) <= b.h / 2) return true;
    }
  }
  return false;
}

/** True when the whole box sits inside the shape. */
export function boxInsideShape(b: Box, shape: Shape): boolean {
  return boxSamples(b).every((p) => pointInShape(p, shape)) && !vertexInBox(shape, b);
}

/** True when the box touches none of the shapes: it sits in empty ground. */
export function boxOutsideShapes(b: Box, shapes: readonly Shape[]): boolean {
  const samples = boxSamples(b);
  for (const s of shapes) {
    if (!bboxHitsBox(s.bbox, b)) continue;
    if (samples.some((p) => pointInShape(p, s)) || vertexInBox(s, b)) return false;
  }
  return true;
}

export interface Seg {
  a: Pt;
  b: Pt;
}

const ccw = (a: Pt, b: Pt, c: Pt): boolean => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);

export function segmentsCross(s: Seg, t: Seg): boolean {
  return ccw(s.a, t.a, t.b) !== ccw(s.b, t.a, t.b) && ccw(s.a, s.b, t.a) !== ccw(s.a, s.b, t.b);
}

/** True when the segment touches the box. */
export function segmentHitsBox(s: Seg, b: Box): boolean {
  const inBox = (p: Pt): boolean => Math.abs(p.x - b.x) <= b.w / 2 && Math.abs(p.y - b.y) <= b.h / 2;
  if (inBox(s.a) || inBox(s.b)) return true;
  const l = b.x - b.w / 2;
  const r = b.x + b.w / 2;
  const t = b.y - b.h / 2;
  const u = b.y + b.h / 2;
  const edges: Seg[] = [
    { a: { x: l, y: t }, b: { x: r, y: t } },
    { a: { x: r, y: t }, b: { x: r, y: u } },
    { a: { x: r, y: u }, b: { x: l, y: u } },
    { a: { x: l, y: u }, b: { x: l, y: t } },
  ];
  return edges.some((e) => segmentsCross(s, e));
}

export interface NumberItem {
  /** Where the number naturally sits: the middle of the district. */
  anchor: Pt;
  size: { w: number; h: number };
  /** The district's own outline. */
  shape: Shape;
}

export interface NumberSpot {
  /** inside: in its own district. outside: in empty ground beside the state, joined by a short leader. */
  kind: 'inside' | 'outside';
  x: number;
  y: number;
}

const SPOT_ANGLES = [0, 180, 90, 270, 45, 225, 135, 315, 22, 202, 112, 292, 67, 247, 157, 337];

/** Directions for spots outside the state: every 11.25 degrees, the coarse ones first. */
const FINE_ANGLES: number[] = [];
for (const step of [90, 45, 22.5, 11.25]) {
  for (let a = 0; a < 360; a += step) if (!FINE_ANGLES.includes(a)) FINE_ANGLES.push(a);
}

/**
 * Places district numbers under one rule: a number sits inside its own
 * district, or in empty ground outside the state a short leader away. It is
 * never inside another district's fill, never on another label, and its
 * leader never crosses another label or leader. What cannot be placed that
 * way is left to the caller, which shows a crowd marker instead.
 */
export class NumberPlacer {
  private readonly boxes: Box[];
  private readonly leaders: Seg[] = [];

  constructor(
    private readonly shapes: readonly Shape[],
    obstacles: readonly Box[],
    private readonly bounds: Bounds,
    private readonly gap = 2,
  ) {
    this.boxes = [...obstacles];
  }

  private free(box: Box): boolean {
    return this.boxes.every((o) => !boxesOverlap(box, o, this.gap)) && this.leaders.every((l) => !segmentHitsBox(l, box));
  }

  /**
   * A spot inside the shape. The label's padding may reach past the edge; its ink (the box less `slack`) must not,
   * so a small district can hold a number whose box is a little larger than the district.
   */
  private inside(shape: Shape, anchor: Pt, size: { w: number; h: number }, slack = { w: 0, h: 0 }): Pt | null {
    const ink = { w: Math.max(10, size.w - slack.w), h: Math.max(10, size.h - slack.h) };
    const fits = (x: number, y: number): boolean => {
      if (!pointInShape({ x, y }, shape)) return false;
      return this.free({ x, y, w: size.w, h: size.h }) && boxInsideShape({ x, y, ...ink }, shape);
    };
    if (fits(anchor.x, anchor.y)) return anchor;
    const reach = Math.min(140, Math.max(shape.bbox[2] - shape.bbox[0], shape.bbox[3] - shape.bbox[1]) / 2 + 6);
    for (let r = 6; r <= reach; r += r < 36 ? 6 : 12) {
      for (const deg of SPOT_ANGLES) {
        const x = anchor.x + Math.cos((deg * Math.PI) / 180) * r;
        const y = anchor.y + Math.sin((deg * Math.PI) / 180) * r;
        if (fits(x, y)) return { x, y };
      }
    }
    return null;
  }

  private outside(anchor: Pt, size: { w: number; h: number }, maxLeader: number): Pt | null {
    for (const r of [10, 16, 22, 28, 34, 40, 48, 64, 80, 96, 120, 150, 180, 220, 300, 400].filter((v) => v <= maxLeader)) {
      for (const deg of FINE_ANGLES) {
        const x = anchor.x + Math.cos((deg * Math.PI) / 180) * r;
        const y = anchor.y + Math.sin((deg * Math.PI) / 180) * r;
        const box = { x, y, w: size.w, h: size.h };
        if (!boxInside(box, this.bounds) || !this.free(box) || !boxOutsideShapes(box, this.shapes)) continue;
        const leader = { a: anchor, b: { x, y } };
        if (this.leaders.some((l) => segmentsCross(l, leader)) || this.boxes.some((o) => segmentHitsBox(leader, o))) continue;
        return { x, y };
      }
    }
    return null;
  }

  private take(kind: NumberSpot['kind'], at: Pt, size: { w: number; h: number }, anchor: Pt): NumberSpot {
    this.boxes.push({ x: at.x, y: at.y, ...size });
    if (kind === 'outside') this.leaders.push({ a: anchor, b: at });
    return { kind, x: at.x, y: at.y };
  }

  /** The number's spot, or null when there is no room under the rule. */
  placeNumber(item: NumberItem, maxLeader = 48): NumberSpot | null {
    const inside = this.inside(item.shape, item.anchor, item.size, { w: 8, h: 10 });
    if (inside) return this.take('inside', inside, item.size, item.anchor);
    const outside = this.outside(item.anchor, item.size, maxLeader);
    return outside ? this.take('outside', outside, item.size, item.anchor) : null;
  }

  /**
   * A spot for the marker that stands in for a crowd of unplaced numbers: inside
   * one of those districts (the biggest that has room), else outside the state.
   */
  placeMarker(size: { w: number; h: number }, members: readonly NumberItem[], centroid: Pt, reach = 160): NumberSpot | null {
    const area = (s: Shape): number => (s.bbox[2] - s.bbox[0]) * (s.bbox[3] - s.bbox[1]);
    for (const m of [...members].sort((a, b) => area(b.shape) - area(a.shape))) {
      const at = this.inside(m.shape, m.anchor, size);
      if (at) return this.take('inside', at, size, m.anchor);
    }
    // A crowd in the middle of the state has no empty ground close by; the marker may sit a little farther out, on a longer leader.
    const out = this.outside(centroid, size, reach);
    return out ? this.take('outside', out, size, centroid) : null;
  }
}
