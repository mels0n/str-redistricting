/**
 * Assigns each district a palette slot so that no two neighbors share one.
 * Districts are visited in number order; each takes the least-used slot
 * that none of its already-colored neighbors holds (ties go to the lowest
 * slot). Deterministic, so a shared link always shows the same colors.
 *
 * `neighbors[i]` lists the 0-based indexes adjacent to district i + 1.
 */
export function assignColors(neighbors: readonly (readonly number[])[], paletteSize: number): number[] {
  const n = neighbors.length;
  const slot = new Array<number>(n).fill(-1);
  const used = new Array<number>(paletteSize).fill(0);
  for (let i = 0; i < n; i++) {
    const taken = new Set<number>();
    for (const j of neighbors[i] ?? []) if (slot[j]! >= 0) taken.add(slot[j]!);
    let best = -1;
    for (let c = 0; c < paletteSize; c++) {
      if (taken.has(c)) continue;
      if (best === -1 || used[c]! < used[best]!) best = c;
    }
    // A planar map never needs more than the palette holds; fall back safely.
    if (best === -1) best = i % paletteSize;
    slot[i] = best;
    used[best]!++;
  }
  return slot;
}

/** Merges two adjacency lists (finished and before-balancing shapes). */
export function unionNeighbors(a: readonly (readonly number[])[], b: readonly (readonly number[])[]): number[][] {
  const n = Math.max(a.length, b.length);
  const out: number[][] = [];
  for (let i = 0; i < n; i++) out.push([...new Set([...(a[i] ?? []), ...(b[i] ?? [])])].sort((x, y) => x - y));
  return out;
}
