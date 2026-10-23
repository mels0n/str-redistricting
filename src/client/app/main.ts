import './zod-config';
import '@fontsource-variable/public-sans/wght.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import './styles.css';
import { config, initDataRelease, setRouteMode, setSkewHandler } from '../shared';
import { mountShell } from './shell';
import { startRouter } from './router';
import { reloadOncePerRelease } from './skew-reload';

const root = document.getElementById('str-viewer');
if (root) {
  setRouteMode(config.routing);
  // Keep the prerendered page on screen until the router replaces it (it waits for the release stamp, up to a few seconds).
  const kept = [...(root.querySelector(':scope > .strv-outlet')?.childNodes ?? [])];
  const outlet = mountShell(root);
  outlet.append(...kept);
  // A release went out while this page was open: reload once so no state mixes files from two releases.
  setSkewHandler(reloadOncePerRelease(() => sessionStorage, () => location.reload()));
  void initDataRelease().then(() => startRouter(outlet));
}
