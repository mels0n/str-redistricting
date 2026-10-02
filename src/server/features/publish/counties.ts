import { DataError } from '../../shared/errors/index.js';

export interface CountyRef {
  readonly fips: string;
  readonly name: string;
}

/**
 * Counties each district touches, from an assignment.csv (`GEOID20,district`). The county is the
 * first five characters of the block GEOID. Lists are sorted by FIPS.
 */
export function countiesByDistrict(csv: string, seats: number, names: ReadonlyMap<string, string>): CountyRef[][] {
  const sets: Set<string>[] = Array.from({ length: seats }, () => new Set<string>());
  const lines = csv.split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line === '') continue;
    const comma = line.indexOf(',');
    const d = Number(line.slice(comma + 1));
    if (comma < 5 || !Number.isInteger(d) || d < 1 || d > seats) throw new DataError(`assignment.csv line ${i + 1} is malformed: ${line}`);
    sets[d - 1]!.add(line.slice(0, 5));
  }
  return sets.map((s) =>
    [...s].sort().map((fips) => {
      const name = names.get(fips);
      if (name === undefined) throw new DataError(`county ${fips} is not in the county name file`);
      return { fips, name };
    }),
  );
}
