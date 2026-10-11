import { STATES } from '../../shared/apportionment/index.js';

export interface Affected {
  /**
   * Abbreviations of the states whose maps read a changed file, in alphabetical order: a block file, or a State House
   * or State Senate boundary file (a reissue can change the district count, so those maps may need a redraw).
   */
  readonly states: string[];
  /** True when another cartographic boundary (cb_) file changed: those feed display files only. */
  readonly display: boolean;
}

/** Which published maps a set of changed Census files touches. */
export function affectedBy(files: readonly string[]): Affected {
  const states = new Set<string>();
  let display = false;
  for (const file of files) {
    const fips = /^tl_\d{4}_(\d{2})_tabblock\d{2}\.zip$/.exec(file)?.[1] ?? /^cb_\d{4}_(\d{2})_sld[lu]_500k\.zip$/.exec(file)?.[1];
    if (fips !== undefined) {
      const abbr = STATES.find((s) => s.fips === fips)?.abbr;
      if (abbr !== undefined) states.add(abbr);
    } else if (file.startsWith('cb_')) display = true;
  }
  return { states: [...states].sort(), display };
}
