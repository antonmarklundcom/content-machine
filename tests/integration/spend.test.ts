import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import {
  monthToDateUsd,
  recordSpend,
  spendStatus,
  SpendCapExceededError,
  withSpendCap,
  reserveSpend,
  releaseSpend,
  reconcileSpendHold,
  listUncertainSpendHolds,
} from "@/lib/spend";

import { FEB, JAN, resetTables, teardown } from "./setup";

/**
 * The spend cap against real SQL (PLAN.md §5.O4.3).
 *
 * Every guarantee this module claims is a property of a statement, not of the
 * TypeScript around it: the increment is `costUsd + $1` inside an upsert, the
 * reservation is a conditional UPDATE whose WHERE clause is the whole lock.
 * Unit tests cannot tell any of that from a mock that returns what it was told
 * to. These can.
 */

const CAP = "10";

beforeEach(async () => {
  process.env.MONTHLY_SPEND_CAP_USD = CAP;
  await resetTables();
});

after(async () => {
  delete process.env.MONTHLY_SPEND_CAP_USD;
  await teardown();
});

test("recordSpend accumulates into one row per UTC day", async () => {
  await recordSpend(0.25, JAN);
  await recordSpend(0.5, JAN);

  const rows = await db.select().from(schema.spendLog);
  assert.equal(rows.length, 1, "two charges on the same day are one row");
  assert.equal(rows[0].day, "2026-01-15");
  assert.equal(Number(rows[0].costUsd), 0.75);
});

test("concurrent recordSpend calls cannot lose an update", async () => {
  // The reason the increment is SQL rather than read-modify-write: the poller
  // and an interactive run charge the same day's row at the same time.
  await Promise.all(Array.from({ length: 20 }, () => recordSpend(0.01, JAN)));

  assert.equal(Number(await monthToDateUsd(JAN)).toFixed(4), "0.2000");
});

test("recordSpend ignores zero and rejects negative or non-finite amounts", async () => {
  await recordSpend(0, JAN);
  await assert.rejects(recordSpend(-5, JAN), /finite and non-negative/);
  await assert.rejects(recordSpend(Number.NaN, JAN), /finite and non-negative/);
  await assert.rejects(recordSpend(Infinity, JAN), /finite and non-negative/);

  assert.equal(await monthToDateUsd(JAN), 0);
  assert.equal((await db.select().from(schema.spendLog)).length, 0);
});

test("month-to-date covers only the month asked about", async () => {
  await recordSpend(1.5, JAN);
  await recordSpend(2.25, FEB);

  assert.equal(await monthToDateUsd(JAN), 1.5);
  assert.equal(await monthToDateUsd(FEB), 2.25);
});

test("an open batch counts against the cap before it is collected", async () => {
  // PR-26's hole: spend_log is written at collection time, so an in-flight
  // batch is money committed that the cap would otherwise read as $0.
  await db.insert(schema.batches).values({
    providerBatchId: "batch_open",
    status: "in_progress",
    model: "gemini-3.7-flash",
    estimatedUsd: "4.000000",
  });
  await db.insert(schema.batches).values({
    providerBatchId: "batch_done",
    status: "collected",
    model: "gemini-3.7-flash",
    estimatedUsd: "99.000000",
  });

  const status = await spendStatus(JAN);
  assert.equal(status.committedUsd, 4, "only in_progress/ended batches are committed");
  assert.equal(status.projectedUsd, 4);
  assert.equal(status.remainingUsd, 6);
});

test("withSpendCap runs the work and releases the reservation afterwards", async () => {
  let ran = false;
  const result = await withSpendCap(3, async () => {
    // Mid-flight the money is held, so a concurrent caller sees it.
    const held = await spendStatus();
    assert.equal(held.projectedUsd, 3, "the reservation is visible while fn runs");
    ran = true;
    return "done";
  });

  assert.equal(ran, true);
  assert.equal(result, "done");
  const after = await spendStatus();
  assert.equal(after.projectedUsd, 0, "the hold is released once fn returns");
});

test("withSpendCap releases the reservation when the work throws", async () => {
  await assert.rejects(
    withSpendCap(3, async () => {
      throw new Error("analysis blew up");
    }),
    /analysis blew up/,
  );

  const status = await spendStatus();
  assert.equal(status.projectedUsd, 0, "a failed run must not leak its hold");
});

test("withSpendCap refuses work that would cross the cap", async () => {
  // Charged to *this* month on purpose: the cap is a month-to-date question and
  // reserveSpend asks it of `new Date()`, so a fixture dated last January would
  // be invisible to the gate under test.
  await recordSpend(9.5);

  let ran = false;
  await assert.rejects(
    withSpendCap(1, async () => {
      ran = true;
    }),
    (err: unknown) => {
      assert.ok(err instanceof SpendCapExceededError);
      assert.equal(err.estimatedUsd, 1);
      assert.match(err.message, /over the \$10\.00 cap/);
      return true;
    },
  );

  assert.equal(ran, false, "the gate refuses before the work starts, not after");
  const reservation = await db.select().from(schema.spendReservation);
  assert.ok(
    reservation.length === 0 || Number(reservation[0].reservedUsd) === 0,
    "a refused reservation holds nothing",
  );
});

test("a second reservation sees the first one's hold, not a stale total", async () => {
  // The case the conditional UPDATE exists for: 6 + 6 > 10, so a caller that
  // arrives while another is mid-flight must be refused, even though the first
  // has written nothing to spend_log yet and both read a $0 billed total.
  //
  // The first call is pinned open rather than raced, because two calls fired at
  // once prove nothing here: `withSpendCap` releases as soon as its fn resolves,
  // so an instantly-resolving fn can legitimately let both through.
  let release!: () => void;
  const holding = new Promise<void>((resolve) => {
    release = resolve;
  });

  let reserved!: () => void;
  const firstHasReserved = new Promise<void>((resolve) => {
    reserved = resolve;
  });

  const first = withSpendCap(6, async () => {
    reserved();
    await holding;
    return "first";
  });
  await firstHasReserved;

  await assert.rejects(
    withSpendCap(6, async () => "second"),
    SpendCapExceededError,
  );

  release();
  assert.equal(await first, "first", "the one that got there first still completes");

  const after = await spendStatus();
  assert.equal(after.projectedUsd, 0, "and its hold is gone once it does");
});

test("the reservation never goes negative on release", async () => {
  await withSpendCap(2, async () => "ok");
  await withSpendCap(2, async () => "ok");

  const [row] = await db.select().from(schema.spendReservation);
  assert.equal(Number(row.reservedUsd), 0, "greatest(0, …) keeps the floor at zero");
});

test("BUG-14: expired crashed hold becomes visible uncertain spend and can be reconciled once", async () => {
  const id = await reserveSpend(6);
  assert.ok(id);
  await db
    .update(schema.spendHolds)
    .set({ expiresAt: new Date(0) })
    .where(eq(schema.spendHolds.id, id));
  const recovered = await spendStatus();
  assert.equal(
    recovered.projectedUsd,
    6,
    "expired estimate still counts, preventing repeated paid calls",
  );
  const [orphan] = await listUncertainSpendHolds();
  assert.equal(orphan.id, id);
  assert.equal(orphan.status, "uncertain");
  await releaseSpend(id);
  assert.equal(
    (await spendStatus()).projectedUsd,
    6,
    "late release cannot erase uncertain paid work",
  );
  await assert.rejects(
    withSpendCap(6, async () => "must not run"),
    SpendCapExceededError,
  );
  await reconcileSpendHold(id, 2);
  assert.equal((await spendStatus()).projectedUsd, 2);
  assert.equal((await listUncertainSpendHolds()).length, 0);
  await assert.rejects(reconcileSpendHold(id, 0), /Only uncertain/);
});
