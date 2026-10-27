import type { HtmlTagDescriptor, Plugin } from 'vite';

/** Vercel Web Analytics, served from the site's own origin, so the `script-src 'self'` policy already allows it. */
export const ANALYTICS_SRC = '/_vercel/insights/script.js';

/** The hook that strips the query and fragment from every page view (public/va-path-only.js). It must run first. */
export const ANALYTICS_FILTER_SRC = '/va-path-only.js';

/** Both scripts are deferred, so they run in this order, after the page is parsed. */
export const analyticsTags = (): HtmlTagDescriptor[] => [
  { tag: 'script', attrs: { defer: true, src: ANALYTICS_FILTER_SRC }, injectTo: 'body' },
  { tag: 'script', attrs: { defer: true, src: ANALYTICS_SRC }, injectTo: 'body' },
];

/**
 * Adds the visit counter to the built pages (every prerendered and share page, and the 404 page, is made from the
 * built index.html). The dev server has no such path, so it is left out there. The privacy page says what it records.
 */
export function webAnalytics(): Plugin {
  return {
    name: 'web-analytics',
    apply: 'build',
    transformIndexHtml() {
      return analyticsTags();
    },
  };
}
