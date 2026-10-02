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

export interface NumberPlacement {
  dx: number;
  dy: number;
  /** False when there was no room: the number is left out and its district stays reachable from the list. */
  shown: boolean;
}

/**
 * Places district numbers in the given order (most important first). A number
 * keeps its spot when free, else moves to the nearest free spot (the caller
 * draws a leader), else is left out. Shown numbers never overlap each other or
 * an obstacle. A point well outside the frame is not placed at all.
 */
export function placeNumbers(points: readonly { x: number; y: number }[], order: readonly number[], size: { w: number; h: number }, obstacles: readonly Box[], bounds: Bounds, radii: readonly number[] = [28, 44, 60, 78, 98, 120, 145, 170, 200]): NumberPlacement[] {
  const out: NumberPlacement[] = points.map(() => ({ dx: 0, dy: 0, shown: true }));
  const placed: Box[] = [...obstacles];
  for (const i of order) {
    const pt = points[i]!;
    const away = pt.x < -40 || pt.y < -40 || pt.x > bounds.w + 40 || pt.y > bounds.h + 40;
    if (away) continue;
    const off = findOffset(pt, size, placed, bounds, 0, radii);
    if (!off) {
      out[i] = { dx: 0, dy: 0, shown: false };
      continue;
    }
    out[i] = { ...off, shown: true };
    placed.push({ x: pt.x + off.dx, y: pt.y + off.dy, ...size });
  }
  return out;
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
