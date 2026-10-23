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
  const outlet = mountShell(root);
  // A release went out while this page was open: reload once so no state mixes files from two releases.
  setSkewHandler(reloadOncePerRelease(() => sessionStorage, () => location.reload()));
  void initDataRelease().then(() => startRouter(outlet));
}
