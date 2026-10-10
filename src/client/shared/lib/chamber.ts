/** The legislative bodies a map can be drawn for. Only the federal House has maps so far. */
export type Chamber = 'federal-house' | 'state-house' | 'state-senate';

export interface ChamberInfo {
  readonly key: Chamber;
  readonly label: string;
  /** Whether maps exist for it yet; the others are shown as coming soon. */
  readonly live: boolean;
  /** The share page's path segment under the state: none for the federal House, so the original /CO/ links keep working. */
  readonly segment: string;
}

export const CHAMBERS: readonly ChamberInfo[] = [
  { key: 'federal-house', label: 'Federal House', live: true, segment: '' },
  { key: 'state-house', label: 'State House', live: false, segment: 'house' },
  { key: 'state-senate', label: 'State Senate', live: false, segment: 'senate' },
];

/** The share page of one state's map for one chamber: /CO/ for the federal House, /CO/senate/ and /CO/house/ for the state chambers. */
export function sharePath(abbr: string, chamber: Chamber): string {
  const segment = CHAMBERS.find((c) => c.key === chamber)?.segment ?? '';
  return segment ? `/${abbr}/${segment}/` : `/${abbr}/`;
}
