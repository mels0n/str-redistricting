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
  /** `fresh`: the mismatch was found on a download that has not been kept, so there is no cached file to delete. */
  constructor(fileName: string, path: string, origin: 'cached' | 'fresh' = 'cached') {
    super(
      origin === 'fresh'
        ? `${fileName}: sha256 does not match the pinned value. The file just downloaded differs from the pinned hash; ` +
          'the Census Bureau may have reissued it. Check the new file, then update the manifest (config/census-sha256.json; this changes the maps).'
        : `${fileName}: sha256 does not match the pinned value. The cached file is corrupt or the Census Bureau reissued it. ` +
          `Delete ${path} to download it again, or, if the Census Bureau reissued it, update the manifest (this changes the maps).`,
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
