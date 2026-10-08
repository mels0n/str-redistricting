import { z } from 'zod';

/** What the Census file server said about one file the last time it was recorded. Every header is optional: some responses omit them. */
export const SourceSchema = z.strictObject({
  url: z.string().url(),
  etag: z.string().min(1).optional(),
  lastModified: z.string().min(1).optional(),
  contentLength: z.number().int().nonnegative().optional(),
});
export type Source = z.infer<typeof SourceSchema>;

/** config/census-sources.json: file name (as in config/census-sha256.json) to its recorded source. */
export const SourcesSchema = z.record(z.string().min(1), SourceSchema);
export type Sources = z.infer<typeof SourcesSchema>;

export interface SourceDiff {
  /** Files whose headers prove the bytes differ from the recorded ones. */
  readonly changed: string[];
  /** Files the headers cannot settle (missing on either side, nothing in common, added or gone): check them by hash. */
  readonly unknown: string[];
}

const HEADERS = ['etag', 'lastModified', 'contentLength'] as const;

/**
 * Compare recorded headers to observed ones. A file is changed when any header present on both sides differs, and
 * unchanged when at least one header is present on both sides and every shared one matches. With nothing to
 * compare it is unknown, never silently unchanged.
 */
export function diffSources(recorded: Readonly<Record<string, Source>>, observed: Readonly<Record<string, Source>>): SourceDiff {
  const changed: string[] = [];
  const unknown: string[] = [];
  for (const file of [...new Set([...Object.keys(recorded), ...Object.keys(observed)])].sort()) {
    const a = recorded[file];
    const b = observed[file];
    if (a === undefined || b === undefined) {
      unknown.push(file);
      continue;
    }
    const shared = HEADERS.filter((h) => a[h] !== undefined && b[h] !== undefined);
    if (shared.length === 0) unknown.push(file);
    else if (shared.some((h) => a[h] !== b[h])) changed.push(file);
  }
  return { changed, unknown };
}
