/** Past about this many characters some mail programs and browsers drop a mailto link. */
export const MAILTO_LIMIT = 1900;

/** The addresses with repeats removed (ignoring case), in the order given. */
export function uniqueEmails(emails: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of emails) {
    const k = e.trim().toLowerCase();
    if (k === '' || seen.has(k)) continue;
    seen.add(k);
    out.push(e.trim());
  }
  return out;
}

/** One link to a new message addressed to everyone. Subject and body are percent-encoded; `@` stays readable in the To list. */
export function groupMailtoHref(emails: readonly string[], letter: { subject: string; body: string }): string {
  const to = emails.map((e) => encodeURIComponent(e).replace(/%40/g, '@')).join(',');
  return `mailto:${to}?subject=${encodeURIComponent(letter.subject)}&body=${encodeURIComponent(letter.body)}`;
}

/** The link when it is short enough to trust; null when the caller should offer copying instead. */
export function fittingMailtoHref(emails: readonly string[], letter: { subject: string; body: string }, limit = MAILTO_LIMIT): string | null {
  if (emails.length === 0) return null;
  const href = groupMailtoHref(emails, letter);
  return href.length <= limit ? href : null;
}
