/** Keeps a divider's size between its limits. A limit that cannot be met (max under min) gives way to the minimum. */
export function clampSize(v: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(v, min), Math.max(min, max)));
}

/** The size after a key press on a splitter, or null for a key it does not use. `grow` is the key that makes the size larger. */
export function splitterKey(key: string, size: number, min: number, max: number, opts: { grow: string; shrink: string; shift: boolean }): number | null {
  const step = opts.shift ? 64 : 16;
  if (key === opts.grow) return clampSize(size + step, min, max);
  if (key === opts.shrink) return clampSize(size - step, min, max);
  if (key === 'Home') return clampSize(min, min, max);
  if (key === 'End') return clampSize(max, min, max);
  return null;
}

const read = (key: string): number | null => {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
};
const write = (key: string, v: number | null): void => {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(v));
  } catch {
    // Storage may be blocked; the size simply is not remembered.
  }
};

export interface SplitterOptions {
  orientation: 'vertical' | 'horizontal';
  label: string;
  storageKey: string;
  /** The size now, in pixels (the column's width or the map's height). */
  size(): number;
  min(): number;
  max(): number;
  /** Sets the size; null returns to the stylesheet's own size. */
  apply(px: number | null): void;
  /** Called after the size changes. */
  onChange?(): void;
}

export interface Splitter {
  el: HTMLElement;
  /** Applies the remembered size, if any. */
  restore(): void;
  /** Re-clamps a custom size after the window changed. */
  refresh(): void;
}

/** A draggable, keyboard-operable divider. Its size is the pixel size of the part before it (the column's width, the map's height). */
export function createSplitter(o: SplitterOptions): Splitter {
  const vertical = o.orientation === 'vertical';
  const el = document.createElement('div');
  el.className = `strv-splitter strv-splitter--${vertical ? 'v' : 'h'}`;
  el.tabIndex = 0;
  el.setAttribute('role', 'separator');
  el.setAttribute('aria-orientation', o.orientation);
  el.setAttribute('aria-label', o.label);
  let custom = false;

  const aria = (): void => {
    el.setAttribute('aria-valuemin', String(Math.round(o.min())));
    el.setAttribute('aria-valuemax', String(Math.round(Math.max(o.min(), o.max()))));
    el.setAttribute('aria-valuenow', String(Math.round(o.size())));
  };
  const set = (px: number, save: boolean): void => {
    const v = clampSize(px, o.min(), o.max());
    custom = true;
    o.apply(v);
    aria();
    if (save) write(o.storageKey, v);
    o.onChange?.();
  };
  const reset = (): void => {
    custom = false;
    o.apply(null);
    write(o.storageKey, null);
    aria();
    o.onChange?.();
  };

  el.addEventListener('focus', aria);
  el.addEventListener('pointerenter', aria);
  el.addEventListener('dblclick', reset);
  el.addEventListener('keydown', (ev) => {
    const next = splitterKey(ev.key, o.size(), o.min(), o.max(), { grow: vertical ? 'ArrowRight' : 'ArrowDown', shrink: vertical ? 'ArrowLeft' : 'ArrowUp', shift: ev.shiftKey });
    if (next === null) return;
    ev.preventDefault();
    set(next, true);
  });
  let drag: { from: number; start: number } | null = null;
  el.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    el.setPointerCapture(ev.pointerId);
    drag = { from: vertical ? ev.clientX : ev.clientY, start: o.size() };
    el.dataset.dragging = 'true';
    aria();
  });
  el.addEventListener('pointermove', (ev) => {
    if (drag) set(drag.start + (vertical ? ev.clientX : ev.clientY) - drag.from, false);
  });
  const end = (): void => {
    if (!drag) return;
    drag = null;
    delete el.dataset.dragging;
    write(o.storageKey, Math.round(o.size()));
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  return {
    el,
    restore() {
      const v = read(o.storageKey);
      if (v !== null) set(v, false);
      else aria();
    },
    refresh() {
      if (custom) set(o.size(), false);
      else aria();
    },
  };
}
