import { h, ordinal, formatInt, type Plan } from '../../shared';
import { balancePlanAt } from '../../entities/plan';

export interface PlanOptionsOptions {
  enactedSource: string;
  onPlan(plan: Plan): void;
  onEnacted(on: boolean): void;
}

/** The step of the cut sequence or the balancing replay on screen; null when neither is open. */
export type ReplayStep = { phase: 'cut'; k: number; total: number } | { phase: 'balance'; m: number; total: number };

export interface PlanOptions {
  el: HTMLElement;
  update(state: { plan: Plan; enacted: boolean; step: ReplayStep | null; enactedFailed: boolean }): void;
}

/**
 * Which plan the control shows as pressed. During the cuts and the balancing replay the replay is its own
 * state, so neither plan is pressed; the replay's last move is the finished map, and the control says so.
 */
export function planPressed(plan: Plan, step: ReplayStep | null): Plan | null {
  if (step === null) return plan;
  if (step.phase === 'balance' && balancePlanAt(step.m, step.total) === 'finished') return 'finished';
  return null;
}

/** One line naming the step the replay is on. */
export function describeStep(step: ReplayStep): string {
  if (step.phase === 'cut') {
    return step.k === 0
      ? 'Cut sequence, before the first cut. The cuts draw the plan before balancing.'
      : `Cut sequence, cut ${formatInt(step.k)} of ${formatInt(step.total)}. The cuts draw the plan before balancing.`;
  }
  const at = `move ${formatInt(step.m)} of ${formatInt(step.total)}`;
  if (step.m === 0) return 'Balancing replay, before the first move. It starts from the plan the cuts left.';
  if (balancePlanAt(step.m, step.total) === 'finished') return `Balancing replay, ${at}. The last move ends on the finished map.`;
  return `Balancing replay, ${at}. Partway between the two plans: the blocks moved so far are in their new districts.`;
}

/** Plain-language name of the Census file the enacted districts come from. */
export function enactedSourceLabel(source: string): string {
  const m = /^cb_(\d{4})_us_cd(\d{3})_/.exec(source);
  if (!m) return `U.S. Census Bureau boundary file ${source}`;
  return `U.S. Census Bureau cartographic boundary file for the ${ordinal(Number(m[2]))} Congress (${m[1]} release, ${source})`;
}

export function createPlanOptions(opts: PlanOptionsOptions): PlanOptions {
  const name = `strv-plan-${Math.random().toString(36).slice(2, 8)}`;
  const radio = (value: Plan, label: string, hint: string): HTMLElement => {
    const input = h('input', {
      type: 'radio',
      name,
      value,
      onchange: () => opts.onPlan(value),
    });
    return h('label', { class: 'strv-seg__option' }, input, h('span', { class: 'strv-seg__label' }, label), h('span', { class: 'strv-seg__hint' }, hint));
  };

  const finished = radio('finished', 'Finished map', 'After balancing');
  const before = radio('before', 'Before balancing', 'Cuts only');
  const group = h('fieldset', { class: 'strv-seg' }, h('legend', { class: 'strv-seg__legend' }, 'Plan shown'), finished, before);

  const enactedBox = h('input', {
    type: 'checkbox',
    id: `${name}-enacted`,
    onchange: (ev: Event) => opts.onEnacted((ev.currentTarget as HTMLInputElement).checked),
  });
  const enacted = h(
    'div',
    { class: 'strv-check' },
    enactedBox,
    h('label', { for: `${name}-enacted` }, h('span', { class: 'strv-check__label' }, 'Compare with the 119th Congress districts'), h('span', { class: 'strv-check__hint' }, `Dashed lines. For comparison only, never used to draw. Source: ${enactedSourceLabel(opts.enactedSource)}.`)),
  );

  const cutNote = h('p', { class: 'strv-options__note' });
  const enactedError = h('p', { class: 'strv-options__error', role: 'status', hidden: true }, 'The 119th Congress districts could not be loaded. Uncheck the box and check it again to retry.');
  const el = h('div', { class: 'strv-options' }, group, cutNote, enacted, enactedError);

  return {
    el,
    update({ plan, enacted: on, step, enactedFailed }) {
      const cutMode = step !== null;
      if (step) cutNote.textContent = describeStep(step);
      const pressed = planPressed(plan, step);
      for (const input of group.querySelectorAll('input')) {
        // The replay is its own state: neither plan is pressed until it ends on the finished map.
        // The visitor's own choice comes back when the replay is closed.
        input.checked = input.value === pressed;
        input.disabled = cutMode;
      }
      group.toggleAttribute('disabled', cutMode);
      cutNote.hidden = !cutMode;
      enactedBox.checked = on;
      enactedError.hidden = !(on && enactedFailed);
    },
  };
}
