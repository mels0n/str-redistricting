import { z } from 'zod';

/** tests/fingerprints/engine.json: the assignment fingerprint of each fixture state at a given engine major. */
export const FingerprintFileSchema = z.strictObject({
  engineMajor: z.number().int().min(1),
  states: z.record(z.string().regex(/^[A-Z]{2}$/), z.string().regex(/^[0-9a-f]{64}$/)),
});
export type FingerprintFile = z.infer<typeof FingerprintFileSchema>;

export function compareFingerprints(
  file: FingerprintFile,
  got: Readonly<Record<string, string>>,
  headEngineMajor: number,
): { ok: boolean; changed: string[]; message: string } {
  const changed = Object.keys(file.states).filter((st) => got[st] !== file.states[st]).sort();
  if (changed.length === 0) return { ok: true, changed, message: 'fixture fingerprints match' };
  const names = changed.join(', ');
  if (headEngineMajor > file.engineMajor) {
    return {
      ok: true,
      changed,
      message: `fixture fingerprints changed for ${names}; the engine major was bumped (${file.engineMajor} to ${headEngineMajor}). Record them with npm run fingerprints -- --record`,
    };
  }
  return {
    ok: false,
    changed,
    message: `the map changed for ${names} but the engine major is still ${headEngineMajor}; bump the engine major (npm run release) and record the new fingerprints with npm run fingerprints -- --record`,
  };
}
