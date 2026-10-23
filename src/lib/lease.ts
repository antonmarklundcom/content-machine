/**
 * Named, expiring locks on the `leases` table (PLAN.md §1.19).
 *
 * Acquire uses a native conditional MariaDB upsert plus a locking read in
 * one transaction. The primary key serializes competitors; the generated
 * holder proves which caller won. No application-clock expiry or transaction
 * replay around external side effects is required.
 *
 * All time arithmetic happens in SQL against the database's `now()`, never
 * `Date.now()`: two machines (the PC's Task Scheduler run and a deployed route)
 * with skewed clocks must still agree on whether a lease has expired.
 */

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { leases } from "@/db/schema";
import type { Tx } from "@/db/mutations";

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
  const row = await db.transaction(async (tx) => {
    // leases has only its primary-key identity; native ODKU locks that row
    // exclusively without a duplicate-INSERT shared-lock upgrade.
    // MySQL assignments are left-to-right: holder must be assigned BEFORE
    // expiresAt, so both conditions inspect the original expiry.
    await tx
      .insert(leases)
      .values({ name, holder, expiresAt })
      .onDuplicateKeyUpdate({
        set: {
          holder: sql`if(${leases.expiresAt} < current_timestamp(3), ${holder}, ${leases.holder})`,
          expiresAt: sql`if(${leases.expiresAt} < current_timestamp(3), ${expiresAt}, ${leases.expiresAt})`,
        },
      });
    const [claimed] = await tx
      .select()
      .from(leases)
      .where(and(eq(leases.name, name), eq(leases.holder, holder)))
      .for("update");
    return claimed;
  });
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
  fn: (lease: Lease) => Promise<T>,
): Promise<LeaseOutcome<T>> {
  const lease = await acquireLease(name, ttlMs);
  if (!lease) return { acquired: false };
  try {
    return { acquired: true, value: await fn(lease) };
  } finally {
    await releaseLease(lease);
  }
}

export class LeaseLostError extends Error {
  constructor() {
    super("This work attempt lost its ownership. Reload before retrying.");
    this.name = "LeaseLostError";
  }
}

/** A stale worker cannot renew or commit after another holder takes ownership. */
export async function assertLeaseCurrent(lease: Lease): Promise<void> {
  const [row] = await db
    .select({ holder: leases.holder })
    .from(leases)
    .where(
      and(
        eq(leases.name, lease.name),
        eq(leases.holder, lease.holder),
        sql`${leases.expiresAt} > current_timestamp(3)`,
      ),
    )
    .limit(1);
  if (!row) throw new LeaseLostError();
}

export async function renewLease(lease: Lease, ttlMs: number): Promise<boolean> {
  const [result] = await db
    .update(leases)
    .set({
      expiresAt: sql`timestampadd(microsecond, ${Math.max(1, Math.round(ttlMs)) * 1000}, current_timestamp(3))`,
    })
    .where(
      and(
        eq(leases.name, lease.name),
        eq(leases.holder, lease.holder),
        sql`${leases.expiresAt} > current_timestamp(3)`,
      ),
    );
  return result.affectedRows > 0;
}

/** Fence database-only commits under the same lock that serializes takeover. */
export async function withLeaseCommit<T>(lease: Lease, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ holder: leases.holder })
      .from(leases)
      .where(
        and(
          eq(leases.name, lease.name),
          eq(leases.holder, lease.holder),
          sql`${leases.expiresAt} > current_timestamp(3)`,
        ),
      )
      .for("update");
    if (!row) throw new LeaseLostError();
    return fn(tx);
  });
}

/** Renew only this live owned lease; failure closes the next explicit commit gate. */
export async function withRenewableLease<T>(
  name: string,
  ttlMs: number,
  fn: (lease: Lease) => Promise<T>,
): Promise<LeaseOutcome<T>> {
  return withLease(name, ttlMs, async (lease) => {
    let inFlight: Promise<unknown> = Promise.resolve();
    const timer = setInterval(
      () => {
        inFlight = inFlight.then(() => renewLease(lease, ttlMs)).catch(() => false);
      },
      Math.max(100, Math.min(30_000, Math.floor(ttlMs / 3))),
    );
    timer.unref();
    try {
      return await fn(lease);
    } finally {
      clearInterval(timer);
      await inFlight;
    }
  });
}
