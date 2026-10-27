import { h, announce, takeSigned, PAGE_META, routeHref, iconArrowLeft, NATIONAL, type Page } from '../../shared';
import { createTakeAction } from '../../widgets/take-action';
import { createVoices } from '../../widgets/voices';

/** The Take action page: the take-action widget on a page of its own. `state` (from `?state=CO`) starts the sign-on form on that state. */
export function createActPage(state: string | null): Page {
  const h1 = h('h1', { class: 'strv-how__h1', tabindex: -1 }, 'Take action');
  const notice = h('p', { class: 'strv-notice', hidden: true });
  const signed = takeSigned();
  if (signed === 'expired' || signed === 'invalid') {
    const text = signed === 'expired' ? 'That link has expired. Sign again to get a new one.' : 'That link was already used or isn’t valid.';
    notice.textContent = text;
    notice.hidden = false;
    announce(text);
  }
  const action = createTakeAction({
    id: 'strv-act-page',
    state,
    makeVoices: (key) => createVoices({ scope: { key }, heading: 'Voices from this district' }),
  });
  const el = h(
    'main',
    { class: 'strv-how strv-act-page', id: 'strv-main' },
    h(
      'header',
      { class: 'strv-how__head' },
      h('a', { href: routeHref(NATIONAL), class: 'strv-back' }, iconArrowLeft(), 'All states'),
      h1,
      h('p', { class: 'strv-how__lede' }, 'Districts should be drawn by a rule anyone can check. Tell your representatives you want that, and add your name so they can see how many of us do.'),
      notice,
    ),
    h('div', { class: 'strv-act-page__body' }, action.el),
  );
  document.title = PAGE_META.act.title;
  return {
    el,
    focusTarget: () => h1,
    destroy() {
      action.destroy();
    },
  };
}
