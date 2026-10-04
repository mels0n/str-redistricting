/**
 * Page zoom (a phone's pinch-zoom of the whole page, as opposed to the map's own zoom).
 *
 * The router swaps pages without a reload, so a pinch-zoom made on one page carries over to the next.
 * The state map takes two-finger gestures for itself, so a page zoomed in until the map fills the
 * screen could never be pinched back out.
 */

/** A little above 1 so rounding in the browser's scale does not count as zoomed. */
const ZOOMED = 1.01;

/** True while the visitor has pinch-zoomed the page in. */
export function pageZoomed(): boolean {
  return (window.visualViewport?.scale ?? 1) > ZOOMED;
}

/**
 * Brings a pinch-zoomed page back to its normal scale: the viewport is briefly capped at scale 1
 * (the browser zooms out to meet the cap), then the cap is lifted so the visitor can zoom again.
 * Some browsers (Safari) may ignore the cap; the map hands pinches back to the page anyway (see watchPageZoom).
 */
export function resetPageZoom(): void {
  if (!pageZoomed()) return;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return;
  // A second reset while the cap is still on keeps the uncapped value it saved first; reading it again
  // would save the cap itself and put it back for good.
  capBase ??= meta.content;
  const base = capBase;
  clearTimeout(capTimer);
  meta.content = `${base}, maximum-scale=1`;
  capTimer = setTimeout(() => {
    meta.content = base;
    capBase = null;
  }, CAP_MS);
}

/** How long the scale cap stays on. */
const CAP_MS = 300;
/** The viewport's own content while a cap is on, else null. */
let capBase: string | null = null;
let capTimer: ReturnType<typeof setTimeout> | undefined;

/** Calls back whenever the page goes from normal scale to zoomed in or back. Returns the function that stops watching. */
export function watchPageZoom(onChange: (zoomed: boolean) => void): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  let zoomed = pageZoomed();
  const check = (): void => {
    const now = pageZoomed();
    if (now === zoomed) return;
    zoomed = now;
    onChange(now);
  };
  vv.addEventListener('resize', check);
  return () => vv.removeEventListener('resize', check);
}
