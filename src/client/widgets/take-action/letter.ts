import { ordinal, type Office } from '../../shared';
import type { Rep } from '../../entities/reps';

export interface LetterInput {
  rep: Rep;
  office: Office;
  stateName: string;
  /** The district code from the reps key: `02`, `00` for at large, `012` for a state district, `CHI` for a named one. */
  districtCode: string;
  mapUrl: string;
}

/** The place the writer lives, as a sentence part: "Colorado’s 2nd congressional district", "Colorado State Senate district 12", or just the state for a statewide seat. */
export function districtPhrase(stateName: string, office: Office, code: string): string {
  const numeric = /^\d+$/.test(code);
  const n = numeric ? String(Number(code)) : code;
  if (office === 'us-senate') return stateName;
  if (office === 'us-house') return numeric && Number(code) === 0 ? stateName : `${stateName}’s ${numeric ? ordinal(Number(code)) : code} congressional district`;
  return `${stateName} ${office === 'state-senate' ? 'State Senate' : 'State House'} district ${n}`;
}

/** The paragraph that names the rule, shared by the letter to one representative and the one to all of them. */
function askParagraph(stateName: string, where: string): string {
  return `I live in ${where}. I am asking you to support drawing ${stateName}’s districts with the Fair Maps rule: split the state along the shortest line that divides its people evenly, repeat until each piece is one district, and publish the code so anyone can check the result.`;
}

/** "A", "A and B", "A, B and C". */
function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The ask to one representative: a short, plain letter that names the rule and links the state's map. */
export function letterText(input: LetterInput): { subject: string; body: string } {
  const { rep, office, stateName, districtCode, mapUrl } = input;
  const subject = `Please support the Fair Maps rule for ${stateName}`;
  const body = [
    `Dear ${rep.name},`,
    '',
    askParagraph(stateName, districtPhrase(stateName, office, districtCode)),
    '',
    `You can see what ${stateName}’s map looks like under this rule at ${mapUrl}.`,
    '',
    'Will you say publicly that you support it?',
    '',
    'Thank you,',
  ].join('\n');
  return { subject, body };
}

export interface GroupLetterInput {
  stateName: string;
  /** The districts of the located address; the U.S. Senate seat is statewide and is not listed. */
  places: readonly { office: Office; code: string }[];
  mapUrl: string;
}

/** One letter to every representative of the writer: the same ask, with the writer's state and districts named once. */
export function groupLetterText(input: GroupLetterInput): { subject: string; body: string } {
  const { stateName, places, mapUrl } = input;
  const phrases = [...new Set(places.map((p) => districtPhrase(stateName, p.office, p.code)))];
  const named = phrases.length > 1 ? phrases.filter((p) => p !== stateName) : phrases;
  const where = named.length > 0 ? andList(named) : stateName;
  const body = [
    'Dear Representatives,',
    '',
    askParagraph(stateName, where),
    '',
    `You can see what ${stateName}’s map looks like under this rule at ${mapUrl}.`,
    '',
    'Will you say publicly that you support it?',
    '',
    'Thank you,',
  ].join('\n');
  return { subject: `Please support the Fair Maps rule for ${stateName}`, body };
}
