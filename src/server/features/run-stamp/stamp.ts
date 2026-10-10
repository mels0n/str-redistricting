import { existsSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

/** The file in a state's output folder that records what its plans were drawn from. Written last, so it also means "complete". */
export const STAMP_FILE = 'inputs.json';

export const RunStampSchema = z.object({
  /** Pinned sha256 of the state's census block file. */
  inputSha256: z.string().regex(/^[0-9a-f]{64}$/),
  seats: z.number().int().positive(),
  /** Major of the engine version, which plans are published under. */
  engineMajor: z.string().min(1),
  /** codeFingerprint of the generator. */
  codeSha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** Every file the run wrote, relative to the state's folder. */
  files: z.array(z.string()),
});
export type RunStamp = z.infer<typeof RunStampSchema>;
export type RunKey = Omit<RunStamp, 'files'>;

/** Why the state has to be drawn again, or undefined when its folder already holds plans drawn from exactly `key`. */
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
  const missing = stamp.files.find((f) => !existsSync(join(dir, f)));
  if (missing !== undefined) return `${missing} is missing`;
  return undefined;
}

/** Removes the stamp before a state is redrawn, so a run that stops partway never leaves a folder that looks complete. */
export async function clearStamp(dir: string): Promise<void> {
  await rm(join(dir, STAMP_FILE), { force: true });
}

/** Writes the stamp after every other file is on disk, through a rename so it is never seen half written. */
export async function writeStamp(dir: string, stamp: RunStamp): Promise<void> {
  const dest = join(dir, STAMP_FILE);
  const tmp = `${dest}.part`;
  await writeFile(tmp, JSON.stringify(stamp, null, 2));
  await rename(tmp, dest);
}
