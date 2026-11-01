import { h, announce, takeSigned, PAGE_META, routeHref, iconArrowLeft, NATIONAL, BADGES, type Page } from '../../shared';
import { FRAME_RING } from '../../features/badge-snippet';
import { createTakeAction } from '../../widgets/take-action';
import { createVoices } from '../../widgets/voices';

/** The Take action page. `state` (from `?state=CO`) starts the sign-on form on that state. */
export function createActPage(state: string | null): Page {
  const h1 = h('h1', { class: 'strv-act-page__h1', tabindex: -1 }, 'Take action');
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
    { class: 'strv-act-page', id: 'strv-main' },
    h(
      'div',
      { class: 'strv-act-page__inner' },
      h('a', { href: routeHref(NATIONAL), class: 'strv-back' }, iconArrowLeft(), 'All states'),
      h1,
      h('p', { class: 'strv-act-page__lede' }, 'Tell your representatives you want districts drawn by a rule, then add your name.'),
      notice,
      action.el,
      h(
        'section',
        { class: 'strv-act-page__support', 'aria-labelledby': 'strv-act-support-h' },
        h('img', { src: FRAME_RING, alt: '', width: '96', height: '96', loading: 'lazy' }),
        h(
          'div',
          null,
          h('h2', { id: 'strv-act-support-h', class: 'strv-act-page__support-h' }, 'Show your support'),
          h('p', null, 'Put the Fair Maps ring on your profile picture, or a badge on your website.'),
          h('a', { href: routeHref(BADGES) }, 'Get a badge'),
        ),
      ),
    ),
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
