// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCutScrubber, type BalanceLogState } from '../../src/client/features/cut-scrubber';
import { config } from '../../src/client/shared';
import type { BalanceLog, Cut, SeqPos } from '../../src/client/entities/plan';

function makeLog(moves: number): BalanceLog {
  const list = Array.from({ length: moves }, (_, i) => ({ order: i + 1, geoid: `08000000000${String(i + 1).padStart(4, '0')}`, from: 1, to: 2, pop: 1, gain: 1 }));
  return { before: [1000 + moves, 1000 - moves], moves: list, blocks: [], blockByGeoid: new Map() } as unknown as BalanceLog;
}

/** A scrubber wired as the state page wires it: each step it reports comes straight back in as the position. */
function setup(moves: number) {
  const cuts = [{ order: 1, seats: 2, lowSeats: 1, highSeats: 1, firstDistrict: 0, angleDeg: 0, lengthM: 1, lines: [], depth: 0 }] as unknown as Cut[];
  const log: BalanceLogState = { status: 'ready', log: makeLog(moves) };
  let pos: SeqPos | null = null;
  const s = createCutScrubber({
    cuts, seats: 2, moves, peopleMoved: moves, rangeBefore: 2 * moves,
    onStep: (p) => { pos = p; s.update(p, { log, canZoom: false }); },
    onFinish: () => undefined, onZoomToMove: () => undefined,
  });
  document.body.append(s.el);
  const live = s.el.querySelector('p.strv-visually-hidden[aria-live="polite"]') as HTMLElement;
  const play = s.el.querySelector('.strv-scrub__play') as HTMLButtonElement;
  return { s, live, play, pos: () => pos, log };
}

describe('the live region while the balancing plays', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

  it('reads out the move a long replay stops on', () => {
    const { s, live, play } = setup(473);
    expect(config.movePlayIntervalMs).toBeGreaterThan(120);
    s.start('balance');
    const opening = live.textContent;
    vi.advanceTimersByTime(config.movePlayMinMs * 5);
    // Quiet while it plays fast: nothing new is read out...
    expect(live.textContent).toBe(opening);
    play.click();
    // ...and the move it stops on is announced.
    expect(live.textContent).toMatch(/^Balancing move \d+ of 473\./);
  });

  it('reads out the move a long replay ends on by itself', () => {
    const { s, live } = setup(473);
    s.start('balance');
    vi.advanceTimersByTime(config.movePlayMinMs * 600);
    expect(live.textContent).toMatch(/^Balancing move 473 of 473\./);
  });

  it('does not stay quiet on a short log', () => {
    const { s, live } = setup(3);
    s.start('balance');
    vi.advanceTimersByTime(config.movePlayIntervalMs * 1.5);
    expect(live.textContent).toMatch(/^Balancing move \d of 3\./);
  });
});
