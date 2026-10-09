/** Insert `## <version> (<date>)` and its bullets directly under the `# ` title, newest first. */
export function prependEntry(md: string, version: string, date: string, lines: readonly string[]): string {
  const all = md.replace(/\r\n/g, '\n').split('\n');
  const at = all.findIndex((l) => l.startsWith('# '));
  const title = at === -1 ? '' : all[at]!;
  const rest = (at === -1 ? all : all.slice(at + 1)).join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
  const entry = `## ${version} (${date})\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`;
  return `${title === '' ? '' : `${title}\n\n`}${entry}${rest === '' ? '' : `\n${rest}\n`}`;
}
