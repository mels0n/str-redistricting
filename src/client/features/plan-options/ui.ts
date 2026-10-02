import { h, type Plan } from '../../shared';

export interface PlanOptionsOptions {
  enactedSource: string;
  onPlan(plan: Plan): void;
  onEnacted(on: boolean): void;
}

export interface PlanOptions {
  el: HTMLElement;
  update(state: { plan: Plan; enacted: boolean; cutMode: boolean; enactedFailed: boolean }): void;
}

/** Plain-language name of the Census file the enacted districts come from. */
export function enactedSourceLabel(source: string): string {
  const m = /^cb_(\d{4})_us_cd(\d{3})_/.exec(source);
  if (!m) return `U.S. Census Bureau boundary file ${source}`;
  return `U.S. Census Bureau cartographic boundary file for the ${Number(m[2])}th Congress (${m[1]} release, ${source})`;
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

  const official = radio('official', 'Official map', 'After balancing');
  const before = radio('before', 'Before balancing', 'Cuts only');
  const group = h('fieldset', { class: 'strv-seg' }, h('legend', { class: 'strv-seg__legend' }, 'Plan shown'), official, before);

  const enactedBox = h('input', {
    type: 'checkbox',
    id: `${name}-enacted`,
    onchange: (ev: Event) => opts.onEnacted((ev.currentTarget as HTMLInputElement).checked),
  });
  const enacted = h(
    'div',
    { class: 'strv-check' },
    enactedBox,
    h('label', { for: `${name}-enacted` }, h('span', { class: 'strv-check__label' }, 'Compare with today’s districts'), h('span', { class: 'strv-check__hint' }, `Dashed lines. For comparison only, never used to draw. Source: ${enactedSourceLabel(opts.enactedSource)}.`)),
  );

  const cutNote = h('p', { class: 'strv-options__note' }, 'The cut sequence shows the plan before balancing, as the cuts left it.');
  const enactedError = h('p', { class: 'strv-options__error', role: 'status', hidden: true }, 'Today’s districts could not be loaded. Uncheck the box and check it again to retry.');
  const el = h('div', { class: 'strv-options' }, group, cutNote, enacted, enactedError);

  return {
    el,
    update({ plan, enacted: on, cutMode, enactedFailed }) {
      for (const input of group.querySelectorAll('input')) {
        input.checked = input.value === plan;
        input.disabled = cutMode;
      }
      group.toggleAttribute('disabled', cutMode);
      cutNote.hidden = !cutMode;
      enactedBox.checked = on;
      enactedError.hidden = !(on && enactedFailed);
    },
  };
}
