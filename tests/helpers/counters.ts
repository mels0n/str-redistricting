/** A cut (or a cut record) without its search counters, which hold timings: everything else must match exactly. */
export function withoutCounters<T extends { readonly scan?: unknown }>(c: T): Omit<T, 'scan'> {
  const { scan: _scan, ...rest } = c;
  return rest;
}

/** A whole plan without the cuts' search counters. */
export function planWithoutCounters<T extends { readonly cuts: readonly { readonly scan?: unknown }[] }>(p: T): Omit<T, 'cuts'> & { cuts: unknown[] } {
  return { ...p, cuts: p.cuts.map(withoutCounters) };
}
