import type { Plugin } from 'vite';
import versions from '../config/versions.json' with { type: 'json' };

/** The one-line summary of every component version, as written into the built page. */
export function versionString(v: typeof versions): string {
  return `engine ${v.engine}; input ${v.input.vintage} r${v.input.revision}; maps ${v.maps}; schema ${v.schema}; web ${v.web}; docs ${v.docs}`;
}

/** Writes `<meta name="version">` into index.html so a saved or crawled page says which release built it. */
export function versionMeta(): Plugin {
  return {
    name: 'version-meta',
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { name: 'version', content: versionString(versions) }, injectTo: 'head' }];
    },
  };
}
