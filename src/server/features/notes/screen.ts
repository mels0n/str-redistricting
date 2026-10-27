import type { NoteRules } from '../../shared/config/note-rules.js';
import { joinSingleLetters, normalizeForScreening, plainForScreening } from './normalize.js';

export type ScreenResult = { result: 'reject'; reason: string } | { result: 'pending'; flags: string[] };

const TLDS = 'com|org|net|us|gov|io|co|info|biz|me|ly';
const URL_RE = /https?:\/\/|\bwww\./;
// A dot joins the name and the ending directly (so "maps. Us people" is not a domain); "dot" is spelled out between spaces.
const DOMAIN_RE = new RegExp(`\\b[a-z0-9-]+(?:\\s*\\.|\\s+dot\\s+)(?:${TLDS})\\b`);
const HANDLE_RE = /@[a-z0-9_]{2,}/;
const EMAIL_RE = /[a-z0-9._%+-]+(?:\s*@\s*|\s+at\s+)[a-z0-9-]+(?:\.|\s+dot\s+)[a-z]{2,}/;
const PHONE_RE = /(?<!\d)(?:\+?1[\s.\-]*)?\(?\d{3}\)?[\s.\-]*\d{3}[\s.\-]*\d{4}(?!\d)/;
const STREET_RE = /\b\d{1,6}\s+([a-z]+\s){0,3}(street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way|place|pl|circle|cir)\b/;

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (words: readonly string[]): RegExp | null => {
  const parts = [...new Set(words.map((w) => normalizeForScreening(w).trim()).filter((w) => w !== ''))].map(escape);
  return parts.length === 0 ? null : new RegExp(`(?<![\\p{L}\\p{N}])(?:${parts.join('|')})(?![\\p{L}\\p{N}])`, 'u');
};

interface Compiled {
  block: RegExp | null;
  flags: { word: string; re: RegExp }[];
}
const compiled = new WeakMap<NoteRules, Compiled>();
function compile(rules: NoteRules): Compiled {
  let c = compiled.get(rules);
  if (!c) {
    c = { block: wordRe(rules.blockWords), flags: rules.flagWords.map((word) => ({ word, re: wordRe([word])! })) };
    compiled.set(rules, c);
  }
  return c;
}

/** Two capitalized words in a row, the first not opening a sentence: probably a person's name. */
function mentionsPerson(body: string): boolean {
  for (const m of body.matchAll(/\p{Lu}\p{Ll}+ \p{Lu}\p{Ll}+/gu)) {
    const before = body.slice(0, m.index);
    if (before.trim() === '' || /[.!?]["')\]]*\s+$/.test(before) || /\n\s*$/.test(before)) continue;
    return true;
  }
  return false;
}

/**
 * Rule-based screening of a note, in order; the first reject wins. Nothing here sends the text anywhere.
 * A note that passes is only 'pending': flags help the reader decide, they never publish or reject.
 */
export function screenNote(body: string, rules: NoteRules): ScreenResult {
  const reject = (reason: string): ScreenResult => ({ result: 'reject', reason });
  if ([...body].length > rules.maxLength) return reject('more than 280 characters');

  const plain = plainForScreening(body);
  const spaced = joinSingleLetters(plain);
  const normalized = normalizeForScreening(body);
  const views = [plain, spaced];
  const email = views.some((v) => EMAIL_RE.test(v));
  // An address written as an email is reported as one, not as a link.
  if (views.some((v) => URL_RE.test(v)) || URL_RE.test(normalized)) return reject('links or handles');
  if (!email && (views.some((v) => DOMAIN_RE.test(v) || HANDLE_RE.test(v)) || DOMAIN_RE.test(normalized))) return reject('links or handles');
  if (email) return reject('email addresses');
  if (views.some((v) => PHONE_RE.test(v))) return reject('phone numbers');
  if (views.some((v) => STREET_RE.test(v))) return reject('street addresses');

  const c = compile(rules);
  if (c.block?.test(normalized)) return reject('words that aren’t allowed here');

  const flags = c.flags.filter((f) => f.re.test(normalized)).map((f) => f.word);
  if (mentionsPerson(body)) flags.push('mentions-person');
  return { result: 'pending', flags };
}
