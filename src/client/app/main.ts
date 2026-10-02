import './zod-config';
import '@fontsource-variable/public-sans/wght.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import './styles.css';
import { h } from '../shared';
import { createSiteHeader } from '../widgets/site-header';
import { startRouter } from './router';

const root = document.getElementById('str-viewer');
if (root) {
  root.classList.add('strv');
  const outlet = h('div', { class: 'strv-outlet' });
  root.append(
    h('a', { href: '#strv-main', class: 'strv-skip', onclick: (ev: Event) => {
      ev.preventDefault();
      const main = document.getElementById('strv-main');
      const target = main?.querySelector<HTMLElement>('h1') ?? main;
      target?.focus();
    } }, 'Skip to content'),
    createSiteHeader(),
    outlet,
  );
  startRouter(outlet);
}
