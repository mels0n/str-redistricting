import type { Office } from '../../shared';
import type { Rep } from '../../entities/reps';

export interface LetterInput {
  rep: Rep;
  office: Office;
  stateName: string;
  districtLabel: string;
  mapUrl: string;
}

/** The ask to one representative: a short, plain letter that names the rule and links the state's map. */
export function letterText(input: LetterInput): { subject: string; body: string } {
  const { rep, stateName, districtLabel, mapUrl } = input;
  const subject = `Please support the Fair Maps rule for ${stateName}`;
  const body = [
    `Dear ${rep.name},`,
    '',
    `I live in ${districtLabel}. I am asking you to support drawing ${stateName}’s districts with the Fair Maps rule: split the state along the shortest line that divides its people evenly, repeat until each piece is one district, and publish the code so anyone can check the result.`,
    '',
    `You can see what ${stateName}’s map looks like under this rule at ${mapUrl}.`,
    '',
    'Will you say publicly that you support it?',
    '',
    'Thank you,',
  ].join('\n');
  return { subject, body };
}
