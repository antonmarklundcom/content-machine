import { upsertReturning } from "@/db/mutations";
/**
 * Named, expiring locks on the `leases` table (PLAN.md §1.19).
 *
 * Acquire is ONE statement — an upsert whose update only fires when the current
 * lease has expired — because the Neon HTTP driver runs a single statement per
 * request: no transaction, no session, so no advisory lock either. Postgres
 * serialises the conflicting inserts on the primary key, so of two concurrent
 * callers exactly one gets a row back.
 *
 * All time arithmetic happens in SQL against the database's `now()`, never
 * `Date.now()`: two machines (the PC's Task Scheduler run and a deployed route)
 * with skewed clocks must still agree on whether a lease has expired.
 */

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { leases } from "@/db/schema";

export type Lease = { name: string; holder: string; expiresAt: Date };

/** The lease name the poll run takes, from the route and the CLI alike. */
export const POLL_LEASE = "poll";

/**
 * Longer than any poll should run (the route's own ceiling is 300s) but short
 * enough that a crashed run blocks the next hourly one at most once.
 */
export const POLL_LEASE_TTL_MS = 30 * 60 * 1000;

/** Take `name` for `ttlMs`, or null if someone else holds an unexpired lease. */
export async function acquireLease(name: string, ttlMs: number): Promise<Lease | null> {
  const holder = randomUUID();
  const expiresAt = sql`timestampadd(microsecond, ${Math.max(1, Math.round(ttlMs)) * 1000}, current_timestamp(3))`;
  const [row] = await upsertReturning(
    db,
    leases,
    { name, holder, expiresAt },
    {
      target: leases.name,
      set: { holder, expiresAt },
      setWhere: sql`${leases.expiresAt} < current_timestamp(3)`,
    },
  );
  return row ?? null;
}

/**
 * Give the lease back. Keyed on `holder` as well as `name`: a run that
 * outlived its TTL and was taken over must not delete its successor's lease.
 */
export async function releaseLease(lease: Pick<Lease, "name" | "holder">): Promise<void> {
  await db.delete(leases).where(and(eq(leases.name, lease.name), eq(leases.holder, lease.holder)));
}

export type LeaseOutcome<T> = { acquired: true; value: T } | { acquired: false };

/**
 * Run `fn` holding `name`, or return `{ acquired: false }` without running it.
 * The lease is released in `finally`, so a throwing `fn` frees it at once
 * rather than after the TTL.
 */
export async function withLease<T>(
  name: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<LeaseOutcome<T>> {
  const lease = await acquireLease(name, ttlMs);
  if (!lease) return { acquired: false };
  try {
    return { acquired: true, value: await fn() };
  } finally {
    await releaseLease(lease);
  }
}
