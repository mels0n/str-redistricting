import { z } from 'zod';
import sourcesJson from '../../../../config/census-sources.json' with { type: 'json' };

/**
 * The hosts a Census download may come from, taken from the URLs recorded in config/census-sources.json (the one
 * place that lists where every pinned file is served). A download whose final address, after redirects, is on any
 * other host, or is not https, is refused: the pinned hashes protect the maps, but a redirect to somewhere else
 * should fail loudly rather than be streamed to disk first.
 */
const SourcesSchema = z.record(z.string().min(1), z.object({ url: z.string().url() }).passthrough());

export const CENSUS_HOSTS: ReadonlySet<string> = new Set(
  Object.values(SourcesSchema.parse(sourcesJson)).map((s) => new URL(s.url).hostname),
);
