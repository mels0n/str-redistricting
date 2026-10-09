/**
 * What the app does when a release went out while the page was open: reload once, so no state mixes files from two
 * releases, and not again for the same release (a reload that still sees the old files must not loop). The release is
 * remembered in session storage; with storage unavailable the app does not reload at all, since it could not stop.
 */
const KEY = 'strv-skew-reload';

export function reloadOncePerRelease(storage: () => Storage, reload: () => void): (release: number) => void {
  return (release) => {
    try {
      const store = storage();
      if (store.getItem(KEY) === String(release)) return;
      store.setItem(KEY, String(release));
    } catch {
      return;
    }
    reload();
  };
}
