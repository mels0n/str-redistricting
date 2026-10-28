import type { EmailKind } from '../../entities/signon-db/index.js';

export interface EmailContent {
  subject: string;
  text: string;
}

/** The exact text of each email. `link` is the full URL with the token; `site` is the site origin. */
export function renderEmail(kind: EmailKind, link: string, site: string): EmailContent {
  if (kind === 'confirm') {
    return {
      subject: 'Confirm your signature for Fair Maps',
      text: [
        'Thanks for signing. Click to confirm, and you’ll be counted in your district:',
        '',
        link,
        '',
        'This link works for 48 hours. If you didn’t sign, ignore this email and nothing happens.',
        '',
        `Changed your mind later? Remove yourself any time at ${site}/remove`,
      ].join('\n'),
    };
  }
  return {
    subject: 'Remove your Fair Maps signature',
    text: [
      'Someone asked to remove this email’s signature from Fair Maps. To remove it, open this link and press Remove me:',
      '',
      link,
      '',
      'The link works for 48 hours. If you didn’t ask, ignore this email and nothing changes.',
    ].join('\n'),
  };
}

/** The link in the email: both open a page; the page's button or script makes the API call. */
export function linkFor(kind: EmailKind, token: string, site: string): string {
  return kind === 'confirm' ? `${site}/confirm?token=${token}` : `${site}/remove?token=${token}`;
}
