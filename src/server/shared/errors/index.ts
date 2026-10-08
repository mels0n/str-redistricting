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

/** The cut search worker pool is unusable (a worker died or stalled); the run can go on with a fresh pool. */
export class WorkerPoolError extends AppError {
  constructor(message: string) {
    super('POOL', message);
  }
}

/** A Census file whose sha256 differs from the pinned value: corrupt cache, or the Census Bureau reissued it. */
export class ChecksumError extends DataError {
  constructor(fileName: string) {
    super(
      `${fileName}: sha256 differs from config/census-sha256.json. If the Census Bureau reissued it, update that file deliberately, ` +
        'then npm run release bumps the input revision; otherwise delete the cached file to re-download.',
    );
  }
}

/** The one place errors become process exit codes. */
export function exitCodeFor(err: unknown): number {
  if (err instanceof ConfigError) return 2;
  if (err instanceof DataError) return 3;
  // A lost worker pool is a fault of the run itself, not of its configuration or input data: the generic failure code.
  if (err instanceof WorkerPoolError) return 1;
  return 1;
}
