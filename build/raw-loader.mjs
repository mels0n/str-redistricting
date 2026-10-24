// Node module hooks that give `import text from './file.md?raw'` the meaning it has in Vite: the file's text as the default export.
// It also gives `import.meta.env` (Vite's, undefined in Node) the values the build would: the default base.
// The prerender script registers this so the real page modules load outside the bundler.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, next) {
  if (!specifier.endsWith('?raw')) return next(specifier, context);
  const url = new URL(specifier.slice(0, -'?raw'.length), context.parentURL);
  return { url: `${url.href}?raw`, shortCircuit: true };
}

export async function load(url, context, next) {
  if (!url.endsWith('?raw')) {
    const loaded = await next(url, context);
    if (loaded.source == null || !url.includes('/src/client/')) return loaded;
    const code = loaded.source.toString();
    if (!code.includes('import.meta.env')) return loaded;
    return { ...loaded, source: code.replaceAll('import.meta.env', "({ BASE_URL: './' })") };
  }
  const text = readFileSync(fileURLToPath(url.slice(0, -'?raw'.length)), 'utf8');
  return { format: 'module', source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
}
