// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createCutScrubber, type BalanceLogState } from '../../src/client/features/cut-scrubber';
import { createDistrictList } from '../../src/client/widgets/district-list';
import { createDistrictTicket } from '../../src/client/widgets/district-ticket';
import { blockTip } from '../../src/client/widgets/district-map/blocks';
import type { Chamber } from '../../src/client/shared';
import type { BalanceLog, Cut, DistrictStats, SeqPos } from '../../src/client/entities/plan';

afterEach(() => {
  document.body.replaceChildren();
});

const stats = (district: number): DistrictStats => ({ district, pop: 1000, counties: [{ name: 'A' }], contiguous: true }) as unknown as DistrictStats;

function scrubberText(chamber?: Chamber): string {
  const cuts = [{ order: 1, seats: 2, lowSeats: 1, highSeats: 1, firstDistrict: 0, angleDeg: 0, lengthM: 1, lines: [], depth: 0 }] as unknown as Cut[];
  const log = { before: [1002, 998], moves: [{ order: 1, geoid: '080000000000001', from: 1, to: 2, pop: 1, gain: 1 }], blocks: [], blockByGeoid: new Map() } as unknown as BalanceLog;
  const state: BalanceLogState = { status: 'ready', log };
  const s = createCutScrubber({
    ...(chamber && { chamber }),
    cuts, seats: 2, moves: 1, peopleMoved: 1, rangeBefore: 4,
    onStep: (p: SeqPos) => s.update(p, { log: state, canZoom: false }),
    onFinish: () => undefined, onZoomToMove: () => undefined,
  });
  document.body.append(s.el);
  s.start('balance');
  return (s.el.querySelector('p.strv-visually-hidden[aria-live="polite"]') as HTMLElement).textContent ?? '';
}

describe('districts are named for the body they belong to', () => {
  it('keeps the federal wording', () => {
    expect(blockTip({ geoid: '1', pop: 2, district: 3 }, 'finished')[2]).toBe('District 3 (finished map)');
    expect(scrubberText()).toContain('from District 1 to District 2');
  });

  it('names state chamber districts in the tooltip, the scrubber, the list and the ticket', () => {
    expect(blockTip({ geoid: '1', pop: 2, district: 3 }, 'finished', 'state-senate')[2]).toBe('State Senate district 3 (finished map)');
    expect(scrubberText('state-house')).toContain('from State House district 1 to State House district 2');

    const list = createDistrictList({ chamber: 'state-senate', onSelect: () => undefined });
    document.body.append(list.el);
    list.update({ districts: [stats(1)], total: 1000, seats: 1, colors: ['#000'], selected: null, located: null, caption: 'c' });
    expect(list.el.querySelector('button')!.getAttribute('aria-label')).toBe('State Senate district 1');

    const ticket = createDistrictTicket('state-senate');
    document.body.append(ticket.el);
    ticket.update({ district: stats(1), color: '#000', total: 1000, seats: 1, plan: 'finished', located: false, preview: false });
    expect(ticket.el.textContent).toContain('State Senate district');
  });

  it('keeps District 1 in the federal list', () => {
    const list = createDistrictList({ onSelect: () => undefined });
    document.body.append(list.el);
    list.update({ districts: [stats(1)], total: 1000, seats: 1, colors: ['#000'], selected: null, located: null, caption: 'c' });
    expect(list.el.querySelector('button')!.getAttribute('aria-label')).toBe('District 1');
  });
});
