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

/** A data file could not be fetched (network failure, timeout, or a non-OK status). */
export class DataLoadError extends ViewerError {
  readonly timedOut: boolean;
  constructor(
    readonly url: string,
    readonly status: number | null,
    options?: { cause?: unknown; timedOut?: boolean },
  ) {
    super(`Could not load ${url}${status === null ? '' : ` (HTTP ${status})`}`, options);
    this.timedOut = options?.timedOut ?? false;
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

/** The map could not be drawn: the browser has no WebGL, or the map code did not load. */
export class MapUnavailableError extends ViewerError {
  constructor(
    readonly kind: 'webgl' | 'load',
    options?: { cause?: unknown },
  ) {
    super(`The map could not be drawn: ${kind}`, options);
  }
}

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
  if (error instanceof MapUnavailableError) {
    return error.kind === 'webgl'
      ? 'This browser cannot draw the map, because WebGL (graphics acceleration) is turned off or missing. Everything else still works: every district is listed in the Districts table with its population and counties, and the cuts and the balancing are described step by step in words.'
      : 'The part of this page that draws the map could not be loaded. Check your connection and try again.';
  }
  if (error instanceof DataLoadError) {
    if (error.timedOut) return 'The map data is taking too long to load. Check your connection and try again.';
    if (error.status === 404) return 'Part of the map data for this page was not found on this site. Try again later.';
    if (error.status !== null && error.status >= 500) return 'The server that holds the map data had a problem. Try again in a moment.';
    return 'The map data could not be loaded. Check that you are online, then try again.';
  }
  if (error instanceof DataShapeError) {
    return 'The map data arrived in a form this page could not read. Try again, and if it keeps happening, the data files on this site may be damaged.';
  }
  return 'Something went wrong. Reload the page to try again.';
}
