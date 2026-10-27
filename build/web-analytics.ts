import type { HtmlTagDescriptor, Plugin } from 'vite';

/** Vercel Web Analytics, served from the site's own origin, so the `script-src 'self'` policy already allows it. */
export const ANALYTICS_SRC = '/_vercel/insights/script.js';

export const analyticsTag = (): HtmlTagDescriptor => ({ tag: 'script', attrs: { defer: true, src: ANALYTICS_SRC }, injectTo: 'body' });

/**
 * Adds the visit counter to the built pages (every prerendered and share page is made from the built index.html).
 * The dev server has no such path, so it is left out there. The privacy page says what it records.
 */
export function webAnalytics(): Plugin {
  return {
    name: 'web-analytics',
    apply: 'build',
    transformIndexHtml() {
      return [analyticsTag()];
    },
  };
}
