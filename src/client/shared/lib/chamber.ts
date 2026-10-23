/** The legislative bodies a map can be drawn for. */
export type Chamber = 'federal-house' | 'state-house' | 'state-senate';

export interface ChamberInfo {
  readonly key: Chamber;
  readonly label: string;
  /** The share page's path segment under the state: none for the federal House, so the original /CO/ links keep working. */
  readonly segment: string;
}

export const CHAMBERS: readonly ChamberInfo[] = [
  { key: 'federal-house', label: 'Federal House', segment: '' },
  { key: 'state-house', label: 'State House', segment: 'house' },
  { key: 'state-senate', label: 'State Senate', segment: 'senate' },
];

/** The share page of one state's map for one chamber: /CO for the federal House, /CO/senate and /CO/house for the state chambers. */
export function sharePath(abbr: string, chamber: Chamber): string {
  const segment = CHAMBERS.find((c) => c.key === chamber)?.segment ?? '';
  return segment ? `/${abbr}/${segment}` : `/${abbr}`;
}

/** Where a chamber's published files live under the data folder: `CO`, `CO/state-house`, `CO/state-senate`. Mirrors the publisher. */
export function chamberDataPath(abbr: string, chamber: Chamber): string {
  return chamber === 'federal-house' ? abbr : `${abbr}/${chamber}`;
}

export function chamberLabel(chamber: Chamber): string {
  return CHAMBERS.find((c) => c.key === chamber)?.label ?? 'Federal House';
}

/** The chamber a link segment names, or null for none. */
export function chamberOfSegment(segment: string | undefined): Chamber | null {
  const found = CHAMBERS.find((c) => c.segment !== '' && c.segment === segment?.toLowerCase());
  return found ? found.key : null;
}

/** "District 3" for the federal House, "State Senate district 12", "State House district 40". */
export function districtLabel(chamber: Chamber, n: number): string {
  return chamber === 'federal-house' ? `District ${n}` : `${chamberLabel(chamber)} district ${n}`;
}

/** The chamber's districts as a count: "435 House seats" is the federal wording; chambers say "N State Senate districts". */
export function chamberSeatsNoun(chamber: Chamber, n: number): string {
  if (chamber === 'federal-house') return `House ${n === 1 ? 'seat' : 'seats'}`;
  return `${chamberLabel(chamber)} ${n === 1 ? 'district' : 'districts'}`;
}
