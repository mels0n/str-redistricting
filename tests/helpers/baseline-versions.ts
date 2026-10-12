import { inputSha256Of, type Versions } from '../../src/server/shared/config/index.js';

/**
 * A fixed 1.0 release baseline for the release tests. They describe how versions move from a known starting point, so
 * they must not read the live config/versions.json, which changes with every release.
 */
export const BASELINE_INPUT_FILES = {
  'config/census-sha256.json': `${JSON.stringify({ 'a.zip': '0'.repeat(64), 'b.zip': '1'.repeat(64) })}\n`,
  'config/enacted.json': `${JSON.stringify({ congress: 119, file: 'cb_x', candidates: ['cb_x'], legislative: { vintage: 2025 } })}\n`,
  'config/legislative-districts.json': `${JSON.stringify({ vintage: 2025, states: { CO: { 'state-house': 65, 'state-senate': 35 } } })}\n`,
} as const;

export const BASELINE_VERSIONS: Versions = {
  engine: '1.0.0',
  input: {
    vintage: 'census-2020',
    revision: 1,
    sha256: inputSha256Of(
      BASELINE_INPUT_FILES['config/census-sha256.json'],
      BASELINE_INPUT_FILES['config/enacted.json'],
      BASELINE_INPUT_FILES['config/legislative-districts.json'],
    ),
  },
  maps: 1,
  schema: '1.0.0',
  web: '1.0.0',
  docs: '1.0.0',
};
