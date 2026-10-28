export type SignonErrorCode =
  | 'bad-request'
  | 'bot-check'
  | 'rate-limit'
  | 'address-not-found'
  | 'outside-states'
  | 'token-invalid'
  | 'token-expired'
  | 'unavailable';

/** A sign-on failure the browser may be told about: `code` is the only thing sent. */
export class SignonError extends Error {
  constructor(readonly code: SignonErrorCode, message: string = code) {
    super(message);
    this.name = 'SignonError';
  }
}
