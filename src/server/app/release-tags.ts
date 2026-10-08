import { ReleaseConfigSchema, tagsFor } from '../features/release/index.js';
import { VersionsSchema, parseReleaseTagsArgs } from '../shared/config/index.js';
import { DataError, exitCodeFor } from '../shared/errors/index.js';
import { showFile } from './git.js';

// Prints the release tags one commit introduces, one per line: the components whose version differs between --before
// and --after. `--before none` (a true root commit) tags every component. Nothing is printed when --before has no
// config/versions.json (versioning had not started there) or when config/release.json at --after does not enforce,
// so merging the branch that adds versioning cannot tag anything before the 1.0 cut.

function tags(): void {
  const { before, after } = parseReleaseTagsArgs(process.argv.slice(2));
  const afterText = showFile(after, 'config/versions.json');
  if (afterText === null) throw new DataError(`config/versions.json does not exist at ${after}`);
  const releaseText = showFile(after, 'config/release.json');
  if (releaseText === null || !ReleaseConfigSchema.parse(JSON.parse(releaseText)).enforce) return;
  const beforeText = before === 'none' ? null : showFile(before, 'config/versions.json');
  if (before !== 'none' && beforeText === null) return;
  const prev = beforeText === null ? null : VersionsSchema.parse(JSON.parse(beforeText));
  for (const tag of tagsFor(prev, VersionsSchema.parse(JSON.parse(afterText)))) console.log(tag);
}

try {
  tags();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(exitCodeFor(err));
}
