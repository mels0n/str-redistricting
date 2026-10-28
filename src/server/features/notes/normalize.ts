/** Lowercase, NFKC, no zero-width characters. The digits and symbols stay as typed (phone numbers and handles need them). */
export function plainForScreening(s: string): string {
  return s.toLowerCase().normalize('NFKC').replace(/[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '');
}

/** Drops the spaces, dots and hyphens between single letters: `w w w` is `www`, `b.a.d` is `bad`. */
export function joinSingleLetters(s: string): string {
  return s.replace(/(?<![\p{L}\p{N}])\p{L}(?:[ .\-]+\p{L}(?![\p{L}\p{N}]))+/gu, (run) => run.replace(/[ .\-]+/g, ''));
}

const LEET: Readonly<Record<string, string>> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

/**
 * The text a blocked word is looked for in: lowercased, NFKC, zero-width characters gone, leetspeak digits and symbols
 * turned into letters, three or more of one letter shortened to one, and the gaps between single letters closed.
 */
export function normalizeForScreening(s: string): string {
  const leet = plainForScreening(s).replace(/[013457@$]/g, (c) => LEET[c] ?? c);
  const collapsed = leet.replace(/(\p{L})\1{2,}/gu, '$1');
  return joinSingleLetters(collapsed);
}
