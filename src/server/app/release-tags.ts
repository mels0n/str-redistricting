import { tagsFor } from '../features/release/index.js';
import { VersionsSchema, parseReleaseTagsArgs } from '../shared/config/index.js';
import { DataError, exitCodeFor } from '../shared/errors/index.js';
import { showFile } from './git.js';

// Prints the release tags one commit introduces, one per line: the components whose version differs between --before
// and --after. `--before none`, or a commit without config/versions.json, tags every component.

function tags(): void {
  const { before, after } = parseReleaseTagsArgs(process.argv.slice(2));
  const afterText = showFile(after, 'config/versions.json');
  if (afterText === null) throw new DataError(`config/versions.json does not exist at ${after}`);
  const beforeText = before === 'none' ? null : showFile(before, 'config/versions.json');
  const prev = beforeText === null ? null : VersionsSchema.parse(JSON.parse(beforeText));
  for (const tag of tagsFor(prev, VersionsSchema.parse(JSON.parse(afterText)))) console.log(tag);
}

try {
  tags();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(exitCodeFor(err));
}
