import { ScanPool } from './pool.js';

/**
 * The pool a run searches with, kept healthy across states. After a state fails, `refresh` swaps a broken pool for a
 * fresh one; if no pool can be made it falls back to no pool (one thread), which gives the same plans, only slower.
 */
export class PoolSlot {
  pool: ScanPool | undefined;

  constructor(private readonly threads: number, private readonly make: (size: number) => ScanPool = (n) => new ScanPool(n)) {
    if (threads > 1) this.replace();
  }

  refresh(): void {
    if (this.pool?.broken) this.replace();
  }

  private replace(): void {
    this.pool = undefined;
    try {
      this.pool = this.make(this.threads);
    } catch {
      // Stay on one thread for the rest of the run.
    }
  }

  async close(): Promise<void> {
    await this.pool?.close();
  }
}
