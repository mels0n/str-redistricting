const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const MINUS = '−';

/** 5773714 -> "5,773,714" */
export function formatInt(n: number): string {
  return intFmt.format(n);
}

/** 119 -> "119th", 121 -> "121st", 112 -> "112th" */
export function ordinal(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** A number of people, keeping any fraction (ideal sizes are not whole). */
export function formatPeople(n: number): string {
  const abs = Math.abs(n);
  const body = Number.isInteger(abs)
    ? intFmt.format(abs)
    : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(abs);
  return n < 0 ? `${MINUS}${body}` : body;
}

/** Signed number of people: +2, −1.25, 0. */
export function formatSignedPeople(n: number): string {
  if (n === 0) return '0';
  const body = formatPeople(Math.abs(n));
  return n < 0 ? `${MINUS}${body}` : `+${body}`;
}

/**
 * A percentage that is already expressed in percent (0.000277 means
 * 0.000277%). Very small values keep two significant digits so they are never
 * rounded away to zero.
 */
export function formatPct(pct: number, signed = false): string {
  if (pct === 0) return '0%';
  const abs = Math.abs(pct);
  let body: string;
  if (abs >= 1) body = abs.toFixed(2);
  else {
    const digits = Math.min(12, Math.max(2, 1 - Math.floor(Math.log10(abs))));
    body = abs.toFixed(digits).replace(/0+$/, '');
  }
  const sign = pct < 0 ? MINUS : signed ? '+' : '';
  return `${sign}${body}%`;
}

/** "1 person", "2 people". */
/** "1 district", "2 districts". */
export function districtCount(n: number): string {
  return `${formatInt(n)} ${n === 1 ? 'district' : 'districts'}`;
}

export function peopleNoun(n: number): string {
  return Math.abs(n) === 1 ? 'person' : 'people';
}

/** 19369 metres -> "19.4 km"; 712836 -> "712.8 km". */
export function formatKm(m: number): string {
  return `${(m / 1000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}

/** Splits a hex digest into fixed-width lines for display as a block. */
export function chunkDigest(hex: string, perLine = 16, perGroup = 4): string[][] {
  const lines: string[][] = [];
  for (let i = 0; i < hex.length; i += perLine) {
    const line = hex.slice(i, i + perLine);
    const groups: string[] = [];
    for (let j = 0; j < line.length; j += perGroup) groups.push(line.slice(j, j + perGroup));
    lines.push(groups);
  }
  return lines;
}
