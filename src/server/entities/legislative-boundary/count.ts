import type { StateInfo } from '../../shared/apportionment/index.js';

/** The two state legislative chambers the Census Bureau publishes boundaries for. */
export type LegislativeChamber = 'state-house' | 'state-senate';

/** The attribute holding a district's code in each chamber's file (read from the pinned files' DBF headers). */
const CODE_FIELD: Record<LegislativeChamber, string> = { 'state-house': 'SLDLST', 'state-senate': 'SLDUST' };

/** The Census code for the area that belongs to no district (water and similar). */
const NO_DISTRICT = 'ZZZ';

/** The name of a state's chamber file, without `.zip`: cb_2025_08_sldl_500k for the Colorado House. */
export const legislativeFileName = (state: StateInfo, chamber: LegislativeChamber, vintage: number): string =>
  `cb_${vintage}_${state.fips}_${chamber === 'state-house' ? 'sldl' : 'sldu'}_500k`;

/** Where the Census Bureau serves a legislative file (name without `.zip`). */
export const legislativeUrl = (file: string): string => {
  const vintage = /^cb_(\d{4})_/.exec(file)?.[1];
  return `https://www2.census.gov/geo/tiger/GENZ${vintage ?? ''}/shp/${file}.zip`;
};

/** Whether `file` (with or without `.zip`) is a legislative boundary file name. */
export const isLegislativeFile = (file: string): boolean => /^cb_\d{4}_\d{2}_sld[lu]_500k(\.zip)?$/.test(file);

/** Distinct district codes among the file's records, skipping only the no-district code. */
export function countDistricts(records: Iterable<Record<string, unknown>>, chamber: LegislativeChamber): number {
  const field = CODE_FIELD[chamber];
  const codes = new Set<string>();
  for (const record of records) {
    const code = record[field];
    if (typeof code === 'string' && code !== NO_DISTRICT) codes.add(code);
  }
  return codes.size;
}
