import { z } from 'zod';
import { VersionsSchema } from '../../shared/config/index.js';

/** tests/fingerprints/engine.json: the assignment fingerprint of each fixture state at a given engine major. */
export const FingerprintFileSchema = z.strictObject({
  engineMajor: z.number().int().min(1),
  states: z.record(z.string().regex(/^[A-Z]{2}$/), z.string().regex(/^[0-9a-f]{64}$/)),
});
export type FingerprintFile = z.infer<typeof FingerprintFileSchema>;

/**
 * The engine major the base branch had: from its config/versions.json, because that is what the base released. The
 * fingerprint file's own engineMajor is a record anyone can rewrite in a pull request and can lag behind the version
 * (an engine major bump that never re-recorded). Falls back to the fingerprint file's when the base has no versions file.
 */
export function baseEngineMajor(baseVersionsText: string | null, fingerprintEngineMajor: number): number {
  if (baseVersionsText === null) return fingerprintEngineMajor;
  return Number(VersionsSchema.parse(JSON.parse(baseVersionsText)).engine.split('.')[0]);
}

/**
 * The fixture gate. `base` is the fingerprint file on the branch being merged into (never the pull request's own
 * copy), `head` is the pull request's file, `drawn` is what the engine draws now.
 * Passes when the engine draws what the base recorded, or when it draws something else, the engine major was raised
 * past the base's, and the head file records exactly the drawn fingerprints at that major.
 */
export function compareFingerprints(
  base: FingerprintFile,
  head: FingerprintFile,
  drawn: Readonly<Record<string, string>>,
  headEngineMajor: number,
): { ok: boolean; changed: string[]; message: string } {
  if (Object.keys(base.states).length === 0) return { ok: true, changed: [], message: 'the base records no fixture states yet; the fixture gate passes' };
  const changed = Object.keys(base.states).filter((st) => drawn[st] !== base.states[st]).sort();
  if (changed.length === 0) return { ok: true, changed, message: 'fixture fingerprints match' };
  const names = changed.join(', ');
  if (headEngineMajor <= base.engineMajor) {
    return {
      ok: false,
      changed,
      message: `the map changed for ${names} but the engine major is still ${headEngineMajor}; bump the engine major (npm run release) and record the new fingerprints with npm run fingerprints -- --record`,
    };
  }
  const recordedOk = head.engineMajor === headEngineMajor && Object.keys(drawn).every((st) => head.states[st] === drawn[st]);
  if (!recordedOk) {
    return {
      ok: false,
      changed,
      message: `the engine major was bumped (${base.engineMajor} to ${headEngineMajor}) but tests/fingerprints/engine.json does not record the fingerprints drawn now at major ${headEngineMajor}; run npm run fingerprints -- --record`,
    };
  }
  return { ok: true, changed, message: `fixture fingerprints changed for ${names}; the engine major was bumped (${base.engineMajor} to ${headEngineMajor}) and the new fingerprints are recorded` };
}
