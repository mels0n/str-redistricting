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
 * obstacle. Stays put (0, 0) when its own spot is free; otherwise the nearest
 * free spot on rings around it, or (0, 0) when the frame is too crowded.
 */
export function offsetToClear(origin: { x: number; y: number }, size: { w: number; h: number }, obstacles: readonly Box[], bounds: Bounds, gap = 0, radii: readonly number[] = [30, 50, 70, 90, 110]): { dx: number; dy: number } {
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
  return { dx: 0, dy: 0 };
}
