import { readFileSync } from 'node:fs';

/** True before the 1.0 cut: config/release.json does not enforce yet. Tests that compare published data skip then. */
export const PRE_RELEASE = (JSON.parse(readFileSync('config/release.json', 'utf8')) as { enforce: boolean }).enforce === false;
