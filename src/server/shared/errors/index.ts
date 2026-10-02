export class AppError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ConfigError extends AppError {
  constructor(message: string) {
    super('CONFIG', message);
  }
}

export class DataError extends AppError {
  constructor(message: string) {
    super('DATA', message);
  }
}

/** A download that did not complete; `status` is the HTTP status when there was a response. */
export class DownloadError extends DataError {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

/** The one place errors become process exit codes. */
export function exitCodeFor(err: unknown): number {
  if (err instanceof ConfigError) return 2;
  if (err instanceof DataError) return 3;
  return 1;
}
