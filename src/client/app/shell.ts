import { clear, h } from '../shared';
import { createSiteHeader } from '../widgets/site-header';
import { createSiteFooter } from '../widgets/site-footer';

/**
 * Builds the page frame (skip link, header, outlet, footer) inside `root` and returns the outlet the router fills.
 * The browser entry and the prerender script both call it, so a prerendered page and a live one start from the same markup.
 */
export function mountShell(root: HTMLElement): HTMLElement {
  clear(root);
  root.classList.add('strv');
  const outlet = h('div', { class: 'strv-outlet' });
  root.append(
    h('a', { href: '#strv-main', class: 'strv-skip', onclick: (ev: Event) => {
      // Always handled here: with <base href="/"> the bare fragment would resolve to "/#strv-main" and leave the page.
      ev.preventDefault();
      const main = document.getElementById('strv-main');
      const target = main?.querySelector<HTMLElement>('h1') ?? main;
      target?.focus();
    } }, 'Skip to content'),
    createSiteHeader(),
    outlet,
    createSiteFooter(),
  );
  return outlet;
}
