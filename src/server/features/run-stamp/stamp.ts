import { createHash } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

/** The file in a state's output folder that records what its plans were drawn from. Written last, so it also means "complete". */
export const STAMP_FILE = 'inputs.json';

const SHA256 = z.string().regex(/^[0-9a-f]{64}$/);

export const RunStampSchema = z.object({
  /** Pinned sha256 of the state's census block file. */
  inputSha256: SHA256,
  seats: z.number().int().positive(),
  /** Major of the engine version, which plans are published under. */
  engineMajor: z.string().min(1),
  /** codeFingerprint of the generator. */
  codeSha256: SHA256,
  /** Every file the run wrote, relative to the state's folder, with the sha256 of what was written. */
  files: z.array(z.object({ path: z.string().regex(/^[a-z0-9][a-z0-9.-]*(\/[a-z0-9][a-z0-9.-]*)*$/i), sha256: SHA256 })).min(1),
});
export type RunStamp = z.infer<typeof RunStampSchema>;
export type RunKey = Omit<RunStamp, 'files'>;

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/**
 * Why the state has to be drawn again, or undefined when its folder already holds plans drawn from exactly `key`.
 * Every file is re-hashed, so a file that was truncated, half synced from another machine, or rewritten by another
 * run counts as changed.
 */
export async function staleReason(dir: string, key: RunKey): Promise<string | undefined> {
  let stamp: RunStamp;
  try {
    stamp = RunStampSchema.parse(JSON.parse(await readFile(join(dir, STAMP_FILE), 'utf8')));
  } catch {
    return 'no complete earlier run';
  }
  if (stamp.inputSha256 !== key.inputSha256) return 'census file changed';
  if (stamp.seats !== key.seats) return 'seat count changed';
  if (stamp.engineMajor !== key.engineMajor) return 'engine major changed';
  if (stamp.codeSha256 !== key.codeSha256) return 'code changed';
  for (const f of stamp.files) {
    let got: string;
    try {
      got = sha256(await readFile(join(dir, f.path)));
    } catch {
      return `${f.path} is missing`;
    }
    if (got !== f.sha256) return `${f.path} changed`;
  }
  return undefined;
}

/** Removes the stamp before a state is redrawn, so a run that stops partway never leaves a folder that looks complete. */
export async function clearStamp(dir: string): Promise<void> {
  await rm(join(dir, STAMP_FILE), { force: true });
}

/** Writes the stamp after every other file is on disk, through a rename so it is never seen half written. */
export async function writeStamp(dir: string, stamp: RunStamp): Promise<void> {
  const dest = join(dir, STAMP_FILE);
  // Unique per process, so two runs on the same folder never share a part file.
  const tmp = `${dest}.${process.pid}.part`;
  try {
    await writeFile(tmp, JSON.stringify(stamp, null, 2));
    await rename(tmp, dest);
  } finally {
    await rm(tmp, { force: true });
  }
}

/** Writes `files` (name to text) under the state's folder, `sub` being a subfolder or '' for the folder itself. */
export type WriteFiles = (sub: string, files: Record<string, string>) => Promise<void>;

export interface DrawOrSkip {
  /** The state's output folder. */
  readonly dir: string;
  readonly key: RunKey;
  /** Draw even when the folder already holds plans drawn from `key`. */
  readonly force: boolean;
  /** Writes files into a folder (creating it). */
  readonly writeDir: (dir: string, files: Record<string, string>) => Promise<void>;
  /** Called with the reason once a draw is decided, before any work. */
  readonly onDraw?: (why: string) => void;
}

/**
 * Skips the state when its folder already holds plans drawn from `key`; otherwise clears the stamp, runs `draw`
 * (which writes every output through the `write` it is given) and stamps the folder last, listing each file
 * written with its hash. A draw that throws leaves no stamp, so the next run draws the state again.
 */
export async function drawOrSkip(opts: DrawOrSkip, draw: (write: WriteFiles) => Promise<void>): Promise<'skipped' | 'drawn'> {
  const why = opts.force ? '--force' : await staleReason(opts.dir, opts.key);
  if (why === undefined) return 'skipped';
  opts.onDraw?.(why);
  await clearStamp(opts.dir);
  const files: RunStamp['files'] = [];
  await draw(async (sub, written) => {
    await opts.writeDir(sub ? join(opts.dir, sub) : opts.dir, written);
    for (const [name, text] of Object.entries(written)) files.push({ path: sub ? `${sub}/${name}` : name, sha256: sha256(text) });
  });
  await writeStamp(opts.dir, { ...opts.key, files });
  return 'drawn';
}
