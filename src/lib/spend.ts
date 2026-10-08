import { AsyncLocalStorage } from "node:async_hooks";
import { insertIfAbsent, updateReturning, upsertReturning } from "@/db/mutations";
import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { batches, spendLog, spendReservation, spendHolds } from "@/db/schema";
import { MODEL_RATES, type AnalysisModel } from "@/lib/analysis/pricing";

/**
 * Spend accounting and the hard monthly cap (PLAN.md §5 row 07).
 *
 * PLAN.md §0 replaced the per-video cost-approval modal with "a monthly spend
 * counter + hard cap", on the reasoning that a modal per $0.02 video is
 * friction protecting nothing. That only holds if the cap is real — so this
 * refuses to *start* work that would exceed it, rather than noticing afterwards.
 */

const DEFAULT_CAP_USD = 25;

export function monthlyCapUsd(): number {
  const raw = process.env.MONTHLY_SPEND_CAP_USD;
  if (raw === undefined || raw === "") return DEFAULT_CAP_USD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `MONTHLY_SPEND_CAP_USD must be a non-negative number, got "${raw}". ` +
        "Set it to 0 to block all spend.",
    );
  }
  return parsed;
}

/** UTC day key, matching spend_log.day. */
export function utcDay(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

export function utcMonthRange(at: Date = new Date()): { start: string; end: string } {
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  // Day 0 of the next month is the last day of this one — avoids month-length
  // and leap-year special cases entirely.
  const end = new Date(Date.UTC(year, month + 1, 0));
  return { start: utcDay(start), end: utcDay(end) };
}

/**
 * Add to the running total for a UTC day.
 *
 * Increments in SQL rather than read-modify-write, so concurrent analyses (the
 * poller and an interactive run at the same time) cannot lose an update.
 */
export async function recordSpend(
  costUsd: number,
  at: Date = new Date(),
  transaction?: SpendTx,
): Promise<void> {
  if (!Number.isFinite(costUsd) || costUsd < 0)
    throw new Error("Recorded spend must be finite and non-negative.");
  const scope = spendScope.getStore(),
    dispatch = scope?.dispatch;
  if (costUsd === 0 && !dispatch?.responseReceived) return;
  const day = utcDay(at),
    amount = costUsd.toFixed(6);
  const record = async (tx: SpendTx) => {
    await lockAndReconcile(tx);
    if (costUsd > 0)
      await upsertReturning(
        tx,
        spendLog,
        { day, costUsd: amount },
        { target: spendLog.day, set: { costUsd: sql`${spendLog.costUsd} + ${amount}` } },
      );
    if (scope?.id)
      await tx
        .update(spendHolds)
        .set({ settledUsd: sql`${spendHolds.settledUsd} + ${amount}`, updatedAt: new Date() })
        .where(and(eq(spendHolds.id, scope.id), inArray(spendHolds.status, ["held", "uncertain"])));
  };
  if (transaction) await record(transaction);
  else await db.transaction(record);
  // An outer transaction must resolve the dispatch only AFTER its commit succeeds.
  if (!transaction && dispatch && scope) scope.pending.delete(dispatch.id);
}

/**
 * Money already committed to the provider and not yet billed here (PR-26).
 *
 * `spend_log` is written at *collection* time, so between submitting a batch
 * and collecting it the cap under-counts by the whole batch — which is exactly
 * the window in which a poll run would submit another one. A batch that is open
 * will be charged; treating that as $0 makes the cap a suggestion.
 *
 * Not filtered by month on purpose. `recordSpend` stamps the collection date,
 * so an open batch submitted last month bills against *this* month whenever it
 * lands, and dropping it from the count would reopen the same hole across the
 * month boundary.
 */
export async function committedUsd(): Promise<number> {
  const [row] = await db
    .select({ total: sql<string | null>`sum(${batches.estimatedUsd})` })
    .from(batches)
    .where(inArray(batches.status, ["in_progress", "ended"]));
  return Number(row?.total ?? 0) || 0;
}

export async function monthToDateUsd(at: Date = new Date()): Promise<number> {
  const { start, end } = utcMonthRange(at);
  const [row] = await db
    .select({ total: sql<string | null>`sum(${spendLog.costUsd})` })
    .from(spendLog)
    .where(and(gte(spendLog.day, start), lte(spendLog.day, end)));
  return Number(row?.total ?? 0) || 0;
}

export type SpendStatus = {
  /** Billed: what `spend_log` holds for this UTC month. */
  monthToDateUsd: number;
  /** Committed but not yet billed: open batches (PR-26). Usually 0. */
  committedUsd: number;
  /**
   * What the cap is actually measured against — billed + committed. Every
   * decision uses this; `monthToDateUsd` alone is a historical figure.
   */
  projectedUsd: number;
  capUsd: number;
  remainingUsd: number;
  /** 0–1+, for the header meter the UI track renders. */
  fraction: number;
  overCap: boolean;
};

const HOLD_TTL_MS = 15 * 60 * 1000;
type Dispatch = { id: string; responseReceived: boolean };
type SpendScope = { id: string | null; pending: Map<string, Dispatch>; dispatch?: Dispatch };
const spendScope = new AsyncLocalStorage<SpendScope>();
const PROCESS_OWNER = `pid:${process.pid}:${randomUUID()}`;
type SpendTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockAndReconcile(tx: SpendTx): Promise<void> {
  await insertIfAbsent(tx, spendReservation, { id: 1, reservedUsd: "0" }, {});
  await tx.execute(sql`select id from spend_reservation where id = 1 for update`);
  const expired = await updateReturning(
    tx,
    spendHolds,
    {
      status: "uncertain",
      uncertainUsd: sql`${spendHolds.estimatedUsd}`,
      accountedDay: utcDay(),
      updatedAt: new Date(),
    },
    and(eq(spendHolds.status, "held"), sql`${spendHolds.expiresAt} <= now()`),
  );
  // A crashed process may already have paid. Retain the estimate as uncertain
  // spend, rather than reopening the cap and accidentally paying again.
  for (const hold of expired) {
    await upsertReturning(
      tx,
      spendLog,
      { day: hold.accountedDay!, costUsd: hold.uncertainUsd ?? hold.estimatedUsd },
      {
        target: spendLog.day,
        set: { costUsd: sql`${spendLog.costUsd} + ${hold.uncertainUsd ?? hold.estimatedUsd}` },
      },
    );
  }
  const [total] = await tx
    .select({ amount: sql<string>`coalesce(sum(${spendHolds.estimatedUsd}),0)` })
    .from(spendHolds)
    .where(eq(spendHolds.status, "held"));
  await tx
    .update(spendReservation)
    .set({ reservedUsd: total.amount })
    .where(eq(spendReservation.id, 1));
}

export async function reconcileExpiredSpendHolds(): Promise<void> {
  await db.transaction(lockAndReconcile);
}

/** Live holds only; expired holds become visible uncertain charges on reconciliation. */
export async function reservedUsd(): Promise<number> {
  const [row] = await db
    .select({ reservedUsd: spendReservation.reservedUsd })
    .from(spendReservation)
    .where(eq(spendReservation.id, 1));
  return Number(row?.reservedUsd ?? 0) || 0;
}

/** Safe recovery view: contains no credentials, prompts or provider tokens. */
export async function listUncertainSpendHolds() {
  await reconcileExpiredSpendHolds();
  return db.select().from(spendHolds).where(eq(spendHolds.status, "uncertain"));
}

/** Owner reconciliation only, after checking the provider bill/output. Never retries work. */
export async function reconcileSpendHold(id: string, actualUsd: number): Promise<void> {
  if (!Number.isFinite(actualUsd) || actualUsd < 0)
    throw new Error("Actual USD must be finite and non-negative.");
  await db.transaction(async (tx) => {
    await lockAndReconcile(tx);
    const [hold] = await tx.select().from(spendHolds).where(eq(spendHolds.id, id));
    if (!hold || hold.status !== "uncertain" || !hold.accountedDay)
      throw new Error("Only uncertain holds can be reconciled.");
    await tx
      .update(spendLog)
      .set({
        costUsd: sql`greatest(0, ${spendLog.costUsd} - ${hold.uncertainUsd ?? hold.estimatedUsd} + ${actualUsd.toFixed(6)})`,
      })
      .where(eq(spendLog.day, hold.accountedDay));
    await tx
      .update(spendHolds)
      .set({ status: "reconciled", actualUsd: actualUsd.toFixed(6), updatedAt: new Date() })
      .where(eq(spendHolds.id, id));
  });
}

export async function spendStatus(at: Date = new Date()): Promise<SpendStatus> {
  await reconcileExpiredSpendHolds();
  const capUsd = monthlyCapUsd();
  const [spent, committed, reserved] = await Promise.all([
    monthToDateUsd(at),
    committedUsd(),
    reservedUsd(),
  ]);
  const projected = spent + committed + reserved;
  return {
    monthToDateUsd: spent,
    committedUsd: committed,
    projectedUsd: projected,
    capUsd,
    remainingUsd: Math.max(0, capUsd - projected),
    fraction: capUsd > 0 ? projected / capUsd : 1,
    overCap: projected >= capUsd,
  };
}

export class SpendCapExceededError extends Error {
  constructor(
    message: string,
    readonly status: SpendStatus,
    readonly estimatedUsd: number,
  ) {
    super(message);
    this.name = "SpendCapExceededError";
  }
}

/**
 * The gate. Throws if the estimated cost would push month-to-date past the cap.
 *
 * Checks the *whole* estimate up front rather than per item, because a batch is
 * submitted as one unit — discovering the cap halfway through is not something
 * you can act on once the requests are already in flight.
 */
export async function assertWithinCap(
  estimatedUsd: number,
  at: Date = new Date(),
): Promise<SpendStatus> {
  const status = await spendStatus(at);

  if (status.projectedUsd + estimatedUsd > status.capUsd) {
    const committed =
      status.committedUsd > 0
        ? ` (of which $${status.committedUsd.toFixed(4)} is committed to batches ` +
          `submitted but not yet collected)`
        : "";
    throw new SpendCapExceededError(
      `Refusing to start: estimated $${estimatedUsd.toFixed(4)} would take ` +
        `this month's spend from $${status.projectedUsd.toFixed(4)}${committed} to ` +
        `$${(status.projectedUsd + estimatedUsd).toFixed(4)}, over the ` +
        `$${status.capUsd.toFixed(2)} cap (MONTHLY_SPEND_CAP_USD). ` +
        `Raise the cap, wait for the month to roll over, or process fewer videos.`,
      status,
      estimatedUsd,
    );
  }
  return status;
}

/** Reserve a traceable attempt under the singleton row lock. */
export async function reserveSpend(estimatedUsd: number, at = new Date()): Promise<string | null> {
  if (!Number.isFinite(estimatedUsd) || estimatedUsd < 0)
    throw new Error("Estimated USD must be finite and non-negative.");
  if (estimatedUsd === 0) return null;
  const id = randomUUID();
  const accepted = await db.transaction(async (tx) => {
    await lockAndReconcile(tx);
    const { start, end } = utcMonthRange(at);
    const [spent] = await tx
      .select({ total: sql<string>`coalesce(sum(${spendLog.costUsd}),0)` })
      .from(spendLog)
      .where(and(gte(spendLog.day, start), lte(spendLog.day, end)));
    const [committed] = await tx
      .select({ total: sql<string>`coalesce(sum(${batches.estimatedUsd}),0)` })
      .from(batches)
      .where(inArray(batches.status, ["in_progress", "ended"]));
    const [held] = await tx.select().from(spendReservation).where(eq(spendReservation.id, 1));
    if (
      Number(spent.total) + Number(committed.total) + Number(held.reservedUsd) + estimatedUsd >
      monthlyCapUsd()
    )
      return false;
    await tx.insert(spendHolds).values({
      id,
      owner: PROCESS_OWNER,
      estimatedUsd: estimatedUsd.toFixed(6),
      expiresAt: sql`timestampadd(microsecond, ${HOLD_TTL_MS * 1000}, current_timestamp(3))`,
    });
    await tx
      .update(spendReservation)
      .set({ reservedUsd: sql`${spendReservation.reservedUsd} + ${estimatedUsd.toFixed(6)}` })
      .where(eq(spendReservation.id, 1));
    return true;
  });
  if (!accepted) {
    const status = await spendStatus(at);
    throw new SpendCapExceededError(
      `Refusing to start: estimated $${estimatedUsd.toFixed(4)} over the $${status.capUsd.toFixed(2)} cap (MONTHLY_SPEND_CAP_USD). Reconcile uncertain holds, wait for the next month, or process fewer items.`,
      status,
      estimatedUsd,
    );
  }
  return id;
}

export async function releaseSpend(id: string | null, confirmedOutcome = false): Promise<void> {
  if (!id) return;
  await db.transaction(async (tx) => {
    await lockAndReconcile(tx);
    const [hold] = await tx.select().from(spendHolds).where(eq(spendHolds.id, id)).for("update");
    if (!hold) return;
    if (hold.status === "uncertain" && confirmedOutcome && hold.accountedDay) {
      // A live request has now durably settled every dispatch. Replace its
      // conservative unknown portion; already-recorded exact charges remain.
      await tx
        .update(spendLog)
        .set({
          costUsd: sql`greatest(0, ${spendLog.costUsd} - ${hold.uncertainUsd ?? hold.estimatedUsd})`,
        })
        .where(eq(spendLog.day, hold.accountedDay));
      await tx
        .update(spendHolds)
        .set({
          status: "released",
          uncertainUsd: "0",
          actualUsd: hold.settledUsd,
          updatedAt: new Date(),
        })
        .where(eq(spendHolds.id, id));
    } else if (hold.status === "held") {
      await tx
        .update(spendHolds)
        .set({ status: "released", actualUsd: hold.settledUsd, updatedAt: new Date() })
        .where(eq(spendHolds.id, id));
      await tx
        .update(spendReservation)
        .set({
          reservedUsd: sql`greatest(0, ${spendReservation.reservedUsd} - ${hold.estimatedUsd})`,
        })
        .where(eq(spendReservation.id, 1));
    }
  });
}

/** Heartbeats identify live work; a crash leaves a bounded, inspectable hold. */
/** Wrap only a provider dispatch, after local validation/client construction. Unknown outcomes stay reserved. */
export async function dispatchSpend<T>(fn: () => Promise<T>): Promise<T> {
  const scope = spendScope.getStore();
  if (!scope) return fn();
  const dispatch = { id: randomUUID(), responseReceived: false };
  scope.pending.set(dispatch.id, dispatch);
  scope.dispatch = dispatch;
  const result = await fn();
  dispatch.responseReceived = true;
  return result;
}
/** Isolate concurrent screening requests while retaining their shared reservation. */
export async function withSpendAttempt<T>(fn: () => Promise<T>): Promise<T> {
  const scope = spendScope.getStore();
  return scope ? spendScope.run({ id: scope.id, pending: scope.pending }, fn) : fn();
}
/** A durable batch ledger now owns the commitment. Call only after storing its remote identity. */
export function markSpendNotDispatched(): void {
  const scope = spendScope.getStore();
  if (scope?.dispatch) scope.pending.delete(scope.dispatch.id);
}
export function markSpendUncertain(): void {
  const scope = spendScope.getStore();
  if (scope?.dispatch) scope.dispatch.responseReceived = false;
}
export function completeSpendCommit(): void {
  const scope = spendScope.getStore();
  if (scope?.dispatch?.responseReceived) scope.pending.delete(scope.dispatch.id);
}
async function retainUncertainSpend(id: string | null): Promise<void> {
  if (!id) return;
  await db.transaction(async (tx) => {
    await lockAndReconcile(tx);
    const [hold] = await updateReturning(
      tx,
      spendHolds,
      {
        status: "uncertain",
        uncertainUsd: sql`${spendHolds.estimatedUsd}`,
        accountedDay: utcDay(),
        updatedAt: new Date(),
      },
      and(eq(spendHolds.id, id), eq(spendHolds.status, "held")),
    );
    if (!hold) return;
    const amount = hold.uncertainUsd ?? hold.estimatedUsd;
    await upsertReturning(
      tx,
      spendLog,
      { day: hold.accountedDay!, costUsd: amount },
      { target: spendLog.day, set: { costUsd: sql`${spendLog.costUsd} + ${amount}` } },
    );
    await tx
      .update(spendReservation)
      .set({
        reservedUsd: sql`greatest(0, ${spendReservation.reservedUsd} - ${hold.estimatedUsd})`,
      })
      .where(eq(spendReservation.id, 1));
  });
}
/** Known billing and held reservations change under the same database lock. */
export async function withSpendCap<T>(estimatedUsd: number, fn: () => Promise<T>): Promise<T> {
  const id = await reserveSpend(estimatedUsd);
  const scope: SpendScope = { id, pending: new Map() };
  const heartbeat = id
    ? setInterval(() => {
        void db
          .update(spendHolds)
          .set({
            expiresAt: sql`timestampadd(microsecond, ${HOLD_TTL_MS * 1000}, current_timestamp(3))`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(spendHolds.id, id),
              eq(spendHolds.owner, PROCESS_OWNER),
              eq(spendHolds.status, "held"),
            ),
          )
          .catch(() => {});
      }, 60_000)
    : null;
  heartbeat?.unref();
  try {
    return await spendScope.run(scope, fn);
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (scope.pending.size) await retainUncertainSpend(id);
    else await releaseSpend(id, true);
  }
}

// ---------------------------------------------------------------------------
// estimation
// ---------------------------------------------------------------------------

/**
 * Tokens per word.
 *
 * PLAN.md §1 works from 5,000 spoken words to ~7,000 input tokens. Caption text
 * is unpunctuated and repetitive, which tokenises slightly worse than prose, so
 * the ratio is rounded up — an estimate that runs high makes the cap trip early,
 * which is the safe direction for a guard.
 */
const TOKENS_PER_WORD = 1.45;

/** PLAN.md §1: the structured analysis output is roughly 2,500 tokens. */
const ESTIMATED_OUTPUT_TOKENS = 2_500;

/** System prompt plus title/channel/duration framing. */
const PROMPT_OVERHEAD_TOKENS = 700;

export function estimateAnalysisCostUsd(
  wordCount: number,
  model: AnalysisModel,
  options: { batch?: boolean } = {},
): number {
  const rates = MODEL_RATES[model];
  const inputTokens = Math.ceil(wordCount * TOKENS_PER_WORD) + PROMPT_OVERHEAD_TOKENS;
  const cost = (inputTokens * rates.input + ESTIMATED_OUTPUT_TOKENS * rates.output) / 1_000_000;
  // PLAN.md §1.2: the Batch API is a flat 50% discount.
  return options.batch ? cost * 0.5 : cost;
}

export function estimateBatchCostUsd(
  wordCounts: number[],
  model: AnalysisModel,
  options: { batch?: boolean } = {},
): number {
  return wordCounts.reduce((sum, w) => sum + estimateAnalysisCostUsd(w, model, options), 0);
}

export function formatUsd(value: number): string {
  return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}

/** Transfer an unverified batch bill into one owner-reconcilable, durable hold. */
export async function retainBatchUncertainty(
  providerBatchId: string,
  reason: string,
): Promise<number> {
  return db.transaction(async (tx) => {
    await lockAndReconcile(tx);
    const [batch] = await tx
      .select()
      .from(batches)
      .where(eq(batches.providerBatchId, providerBatchId))
      .for("update");
    if (!batch || ["collected", "canceled", "uncertain"].includes(batch.status)) return 0;
    const day = utcDay(),
      amount = batch.estimatedUsd,
      id = "batch:" + batch.id;
    await insertIfAbsent(
      tx,
      spendHolds,
      {
        id,
        owner: "batch:" + providerBatchId,
        estimatedUsd: amount,
        status: "uncertain",
        uncertainUsd: amount,
        accountedDay: day,
        expiresAt: new Date(),
        recoveryNote: reason.slice(0, 1024),
      },
      { target: spendHolds.id },
    );
    if (Number(amount) > 0)
      await upsertReturning(
        tx,
        spendLog,
        { day, costUsd: amount },
        { target: spendLog.day, set: { costUsd: sql`${spendLog.costUsd} + ${amount}` } },
      );
    await tx.update(batches).set({ status: "uncertain" }).where(eq(batches.id, batch.id));
    return Number(amount);
  });
}
