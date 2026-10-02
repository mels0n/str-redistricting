/** A box by its centre and size, in pixels inside the map frame. */
export interface FitBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FitPadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface FitInput {
  frameW: number;
  frameH: number;
  /** The key sits in its own row below the map (a phone), so the map needs no room at the top for it. */
  keyBelow: boolean;
  /** The key, when it lies over the map. */
  key: FitBox | null;
  /** The zoom buttons, when they lie over the map. */
  controls: FitBox | null;
}

/** Never leave less than this share of either side for the state itself. */
const MIN_SHARE = 0.4;

/**
 * Room to keep clear around the state when it is fitted to the frame: a base margin, the key's own height at the top,
 * and the zoom buttons' width at the side they sit on. A frame too small to give all of that still keeps 40% of each side.
 */
export function fitPadding(i: FitInput): FitPadding {
  const narrow = i.frameW < 520 || i.frameH < 400;
  const base: FitPadding = narrow
    ? i.keyBelow
      ? { top: 14, right: 14, bottom: 14, left: 14 }
      : { top: i.frameW < 380 ? 64 : 40, right: 14, bottom: 14, left: 14 }
    : { top: 52, right: 32, bottom: 32, left: 32 };
  const pad = { ...base };
  if (i.key) pad.top = Math.max(pad.top, i.key.y + i.key.h / 2 + 8);
  if (i.controls) {
    const left = i.controls.x - i.controls.w / 2;
    const right = i.controls.x + i.controls.w / 2;
    // The buttons belong to the side nearer to them.
    if (left > i.frameW / 2) pad.right = Math.max(pad.right, i.frameW - left + 8);
    else if (right < i.frameW / 2) pad.left = Math.max(pad.left, right + 8);
  }
  const maxV = i.frameH * (1 - MIN_SHARE);
  const maxH = i.frameW * (1 - MIN_SHARE);
  const v = pad.top + pad.bottom;
  if (v > maxV) {
    const k = maxV / v;
    pad.top *= k;
    pad.bottom *= k;
  }
  const hz = pad.left + pad.right;
  if (hz > maxH) {
    const k = maxH / hz;
    pad.left *= k;
    pad.right *= k;
  }
  return { top: Math.round(pad.top), right: Math.round(pad.right), bottom: Math.round(pad.bottom), left: Math.round(pad.left) };
}
