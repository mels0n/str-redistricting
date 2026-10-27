import { config } from '../config';

/** The two kinds of report the repository has a form for. */
export type FeedbackKind = 'question' | 'problem';

/** A link that opens a new GitHub issue on the form for this kind of report. */
export const feedbackHref = (kind: FeedbackKind): string => `${config.repoUrl}/issues/new?template=${kind}.yml`;
