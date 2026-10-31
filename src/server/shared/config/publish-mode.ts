import { ConfigError } from '../errors/index.js';
import { parsePublishConfig, type PublishConfig } from './index.js';

export type PublishRunConfig = PublishConfig & {
  /** Absent means false. Rewrite only the badge files of the published states; leaves every other file untouched. */
  readonly badgesOnly?: boolean;
};

/** The publish command line: `--badges-only` on top of the options `parsePublishConfig` reads. It stays here so the map generator's config module is unchanged. */
export function parsePublishRunConfig(argv: readonly string[]): PublishRunConfig {
  const badgesOnly = argv.includes('--badges-only');
  const cfg = parsePublishConfig(argv.filter((a) => a !== '--badges-only'));
  if (badgesOnly && (cfg.enactedOnly || cfg.blocksOnly)) throw new ConfigError('--badges-only cannot be combined with --enacted-only or --blocks-only');
  return { ...cfg, badgesOnly };
}
