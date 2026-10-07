import { prefersReducedMotion } from '../../shared';

export interface Player {
  readonly index: number;
  readonly playing: boolean;
  play(): void;
  pause(): void;
  next(): void;
  prev(): void;
  /** Move to a step without touching playback. */
  goTo(i: number, announce: boolean): void;
  destroy(): void;
}

/**
 * Steps through `steps` frames. Autoplay dwells `dwellMs` on each and stops at the last; it never runs under
 * reduced motion. `onStep(i, announce)`: announce is true only when the visitor moved the step themselves.
 */
export function createPlayer(steps: number, onStep: (i: number, announce: boolean) => void, dwellMs = 2200): Player {
  let index = 0;
  let timer: number | null = null;
  const last = steps - 1;

  const stop = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };
  const go = (i: number, announce: boolean): void => {
    index = Math.min(Math.max(i, 0), last);
    onStep(index, announce);
  };
  const schedule = (): void => {
    timer = window.setTimeout(() => {
      timer = null;
      go(index + 1, false);
      if (index < last) schedule();
    }, dwellMs);
  };

  return {
    get index() {
      return index;
    },
    get playing() {
      return timer !== null;
    },
    play() {
      if (prefersReducedMotion() || steps < 2 || timer !== null) return;
      if (index >= last) go(0, false);
      schedule();
    },
    pause: stop,
    next() {
      stop();
      go(index + 1, true);
    },
    prev() {
      stop();
      go(index - 1, true);
    },
    goTo(i, announce) {
      go(i, announce);
    },
    destroy: stop,
  };
}
