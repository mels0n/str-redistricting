/**
 * Typed errors for the viewer. Every error a visitor can see is mapped to
 * plain-language copy in exactly one place: `describeError`.
 */
export class ViewerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** A data file could not be fetched (network failure or a non-OK status). */
export class DataLoadError extends ViewerError {
  constructor(
    readonly url: string,
    readonly status: number | null,
    options?: { cause?: unknown },
  ) {
    super(`Could not load ${url}${status === null ? '' : ` (HTTP ${status})`}`, options);
  }
}

/** A data file arrived but does not have the expected shape. */
export class DataShapeError extends ViewerError {
  constructor(
    readonly url: string,
    readonly detail: string,
  ) {
    super(`Unexpected data in ${url}: ${detail}`);
  }
}

export type GeocodeFailure = 'empty' | 'no-match' | 'network' | 'timeout' | 'bad-response';

/** The address lookup failed. */
export class GeocodeError extends ViewerError {
  constructor(
    readonly kind: GeocodeFailure,
    options?: { cause?: unknown },
  ) {
    super(`Address lookup failed: ${kind}`, options);
  }
}

/** The visitor asked for a state that is not in the index. */
export class UnknownStateError extends ViewerError {
  constructor(readonly abbr: string) {
    super(`Unknown state ${abbr}`);
  }
}

/** Plain-language copy for any error the viewer can raise. */
export function describeError(error: unknown): string {
  if (error instanceof GeocodeError) {
    switch (error.kind) {
      case 'empty':
        return 'Type a street address, including the city and state or the ZIP code.';
      case 'no-match':
        return 'The Census Bureau could not find that address. Check the spelling, or add the city and state or the ZIP code.';
      case 'timeout':
        return 'The Census Bureau did not answer in time. Try again in a moment.';
      case 'network':
        return 'The Census Bureau address service could not be reached. Check your connection and try again.';
      case 'bad-response':
        return 'The Census Bureau sent an answer this page could not read. Try again in a moment.';
    }
  }
  if (error instanceof UnknownStateError) {
    return `There is no state with the code ${error.abbr}.`;
  }
  if (error instanceof DataLoadError) {
    return 'The map data could not be loaded. Check your connection and try again.';
  }
  if (error instanceof DataShapeError) {
    return 'The map data could not be read. Reload the page to try again.';
  }
  return 'Something went wrong. Reload the page to try again.';
}
