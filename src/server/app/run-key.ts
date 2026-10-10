import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blocksFileName } from '../entities/census-block/index.js';
import { codeFingerprint, type RunKey } from '../features/run-stamp/index.js';
import { engineMajor, pinnedSha256, VERSIONS } from '../shared/config/index.js';
import type { StateInfo } from '../shared/apportionment/index.js';

/** The explore entry point, whose imports are what a plan is drawn by. */
const EXPLORE_ENTRY = fileURLToPath(new URL('./cli.ts', import.meta.url));

/** Fingerprint of everything an explore run executes. Explore and publish-data must agree on it, so both read it here. */
export const exploreCodeSha256 = (): string => codeFingerprint([EXPLORE_ENTRY], resolve(EXPLORE_ENTRY, '../../../..'));

/** What a state's plans must have been drawn from to be current: the pinned census file, seats, engine major and code. */
export const runKeyFor = (state: StateInfo, codeSha256: string): RunKey => ({
  inputSha256: pinnedSha256(blocksFileName(state)),
  seats: state.seats,
  engineMajor: engineMajor(VERSIONS.engine),
  codeSha256,
});
