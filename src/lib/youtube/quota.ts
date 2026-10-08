/**
 * YouTube Data API quota accounting.
 *
 * The default allowance is 10,000 units/day and it is NOT a rate limit — it is a
 * daily budget that, once spent, returns 403 quotaExceeded until midnight
 * Pacific. So the useful discipline is choosing cheap endpoints, not retrying
 * harder.
 *
 * The cost table is what makes this project comfortably quota-safe:
 *
 *   search.list          100 units   <- never used; see below
 *   videos.list            1 unit    up to 50 ids per call
 *   playlistItems.list     1 unit    up to 50 items per page
 *   channels.list          1 unit
 *
 * search.list is 100x the cost of every alternative and is deliberately absent
 * from this client. A channel's uploads are reachable for 1 unit via
 * channels.list -> contentDetails.relatedPlaylists.uploads -> playlistItems.list,
 * which returns the same videos, in reliable order, for 1/100th of the budget.
 *
 * Concretely: polling 50 tracked channels hourly costs ~2 units each per poll
 * (uploads page + metadata batch), so ~100 units/hour, ~2,400/day — roughly a
 * quarter of the allowance. With search.list it would be 120,000/day and the
 * project would be impossible. Hence the constraint drives the design rather
 * than being discovered later.
 */

export const QUOTA_COSTS = {
  "videos.list": 1,
  "playlistItems.list": 1,
  "playlists.list": 1,
  "channels.list": 1,
  /** Present for completeness and to document the cost. Never called. */
  "search.list": 100,
} as const;

export type QuotaOperation = keyof typeof QUOTA_COSTS;

export const DEFAULT_DAILY_QUOTA = 10_000;

/**
 * Per-process accounting. It resets when the process does, so it is a guard
 * against a runaway loop inside one run rather than a true daily ledger —
 * Google's own counter is the authority. That is the right trade here: a
 * persistent counter would need its own table and would still be wrong after
 * any manual API use.
 */
export class QuotaTracker {
  private spent = 0;
  private readonly calls: Array<{ op: QuotaOperation; units: number }> = [];

  constructor(private readonly budget: number = DEFAULT_DAILY_QUOTA) {}

  /** Throws before spending if this call would exceed the run's budget. */
  charge(op: QuotaOperation): void {
    const units = QUOTA_COSTS[op];
    if (this.spent + units > this.budget) {
      throw new QuotaExhaustedError(
        `Refusing ${op} (${units} units): this run has spent ${this.spent} of ` +
          `${this.budget} units. Raise YOUTUBE_QUOTA_BUDGET or wait for the ` +
          `daily reset (midnight America/Los_Angeles).`,
      );
    }
    this.spent += units;
    this.calls.push({ op, units });
  }

  get unitsSpent(): number {
    return this.spent;
  }

  get unitsRemaining(): number {
    return Math.max(0, this.budget - this.spent);
  }

  summary(): string {
    const byOp = new Map<QuotaOperation, { n: number; units: number }>();
    for (const c of this.calls) {
      const e = byOp.get(c.op) ?? { n: 0, units: 0 };
      e.n += 1;
      e.units += c.units;
      byOp.set(c.op, e);
    }
    const parts = [...byOp.entries()].map(([op, e]) => `${op} x${e.n} = ${e.units}u`);
    return `${this.spent}u spent of ${this.budget}u${parts.length ? ` (${parts.join(", ")})` : ""}`;
  }
}

export class QuotaExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaExhaustedError";
  }
}
