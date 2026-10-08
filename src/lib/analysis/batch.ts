import { upsertReturning } from "@/db/mutations";
import { JobState, type BatchJob, type JobError } from "@google/genai";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { analyses, batches, transcripts, videos, type Batch, type Video } from "@/db/schema";
import {
  completeSpendCommit,
  dispatchSpend,
  estimateBatchCostUsd,
  retainBatchUncertainty,
  withSpendCap,
} from "@/lib/spend";
import { parseAnalysisResponse } from "./parse";
import {
  DEFAULT_MODEL,
  estimateCostUsd,
  isAnalysisModel,
  toCostString,
  type AnalysisModel,
  type TokenUsage,
} from "./pricing";
import { ANALYSIS_JSON_SCHEMA, ANALYSIS_SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import {
  gemini,
  insertAnalysis,
  MAX_OUTPUT_TOKENS,
  readUsage,
  responseText,
  THINKING_LEVEL,
} from "./run";

/**
 * Batch API path for the nightly poller (PLAN.md §1.2).
 *
 * The channel/playlist job is inherently asynchronous — nobody is waiting on
 * it — so accepting batch latency buys a flat 50% discount. This alone halves
 * the running cost, which is why the poller uses this path and the interactive
 * /api/analyze route does not.
 *
 * PLAN.md §5.O3 kept this path across the provider swap rather than losing it:
 * Gemini's Batch API is the same bargain — a 24-hour target turnaround for
 * exactly half price on input and output alike, confirmed against Google's
 * pricing page on 2026-08-29 — so the poller's economics did not change with
 * the provider.
 */

const CUSTOM_ID_PREFIX = "video-";

/** The request-metadata key carrying our own id — Gemini's `custom_id`. */
const CUSTOM_ID_KEY = "custom_id";

export type BatchSubmission = {
  batchId: string;
  videoIds: number[];
  estimatedUsd: number;
};

export type BatchOutcome = {
  succeeded: number;
  failed: number;
  expired: number;
  /** Entries skipped because a previous collection of this batch already wrote them (PR-32). */
  alreadyWritten: number;
  actualUsd: number;
};

/**
 * Build and submit a batch, refusing up front if it would breach the cap.
 *
 * The cap is checked against the whole batch before submission: once requests
 * are in flight there is no partial-cancel that gets you a partial refund, so
 * "check halfway through" is not a real option.
 */
export async function submitAnalysisBatch(
  videoList: Video[],
  options: { model?: AnalysisModel } = {},
): Promise<BatchSubmission | null> {
  const model = options.model ?? DEFAULT_MODEL;
  if (videoList.length === 0) return null;

  const rows = await db
    .select({
      videoId: transcripts.videoId,
      content: transcripts.content,
      wordCount: transcripts.wordCount,
    })
    .from(transcripts)
    .where(
      inArray(
        transcripts.videoId,
        videoList.map((v) => v.id),
      ),
    );

  const byVideoId = new Map(rows.map((r) => [r.videoId, r]));
  const usable = videoList.filter((v) => {
    const t = byVideoId.get(v.id);
    return t && t.content.trim().length > 0;
  });
  if (usable.length === 0) return null;

  const estimatedUsd = estimateBatchCostUsd(
    usable.map((v) => byVideoId.get(v.id)?.wordCount ?? 0),
    model,
    { batch: true },
  );

  // Held for the duration of submission, not just checked-then-forgotten: two
  // concurrent submitAnalysisBatch calls (poller + a manual backfill, say)
  // must not both pass the check before either's `batches` row exists (that
  // row is what committedUsd() reads from here on — see withSpendCap).
  return withSpendCap(estimatedUsd, async () => {
    // The batch path stays English-only, deliberately (PR-22b). prompt_version is
    // written at *collection* time, and a collecting run has no memory of what the
    // submitting run asked for — making the batch multilingual means storing the
    // language on `batches`, which is a schema change this PR is not approved to
    // make. Whoever adds the language UI adds that column with it.
    //
    // Inlined requests rather than a file: the whole batch travels in the create
    // call, which keeps this one round trip with no bucket to configure. The
    // tradeoff is a payload ceiling — a poll run assembles at most
    // findPendingVideos()'s page of transcripts, comfortably inside it, but a
    // much larger backfill would need the file path instead (KNOWN-ISSUES.md).
    const requests = usable.map((video) => {
      const transcript = byVideoId.get(video.id)!;
      return {
        model,
        metadata: { [CUSTOM_ID_KEY]: `${CUSTOM_ID_PREFIX}${video.id}` },
        contents: buildUserPrompt({
          title: video.title,
          channelTitle: video.channelTitle,
          durationSeconds: video.durationSeconds,
          transcript: transcript.content,
        }),
        config: {
          systemInstruction: ANALYSIS_SYSTEM_PROMPT,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          thinkingConfig: { thinkingLevel: THINKING_LEVEL },
          responseMimeType: "application/json",
          responseJsonSchema: ANALYSIS_JSON_SCHEMA,
        },
      };
    });

    const batch = await dispatchSpend(() => gemini().batches.create({ model, src: requests }));

    // Record the id BEFORE returning, and never behind a caller's opt-in: the
    // window between "the provider has taken the job" and "this app knows the id"
    // is exactly the window in which a crash strands paid work.
    const providerBatchId = batch.name;
    if (!providerBatchId) {
      // Nothing to record and nothing to collect. Failing loudly here, with the
      // reservation still held, beats returning a submission whose id is
      // undefined and losing the batch silently.
      throw new Error("Gemini accepted the batch but returned no job name to track it by.");
    }

    await recordBatchSubmission({
      providerBatchId,
      model,
      videoCount: usable.length,
      estimatedUsd,
    });

    completeSpendCommit();
    return { batchId: providerBatchId, videoIds: usable.map((v) => v.id), estimatedUsd };
  });
}

/**
 * Store a submitted batch. Safe to re-run — the unique index on
 * provider_batch_id turns a repeat into a no-op rather than a duplicate ledger
 * entry, which matters because this is called on a path that has already spent
 * money and must not throw.
 */
export async function recordBatchSubmission(input: {
  providerBatchId: string;
  model: AnalysisModel;
  videoCount: number;
  estimatedUsd: number;
}): Promise<void> {
  await upsertReturning(
    db,
    batches,
    {
      providerBatchId: input.providerBatchId,
      status: "in_progress",
      model: input.model,
      videoCount: input.videoCount,
      estimatedUsd: toCostString(input.estimatedUsd),
    },
    {
      target: batches.providerBatchId,
      set: { providerBatchId: input.providerBatchId },
    },
  );
}

/**
 * Every batch this app submitted and has not finished with.
 *
 * Terminal rows are excluded rather than filtered by age: the whole point of
 * the table is that a batch stranded by a multi-day outage is still found.
 */
export async function openBatches(): Promise<Batch[]> {
  return db
    .select()
    .from(batches)
    .where(notInArray(batches.status, ["collected", "canceled", "uncertain"]));
}

/**
 * How long an unreadable batch stays open before the poller gives up on it.
 *
 * The provider's own target turnaround for a batch is 24 hours; a row this app
 * cannot read for three days is not late, it is
 * gone — deleted server-side, or submitted against a key that no longer sees
 * it. Before PR-26 a stranded row cost one failed retrieve per run. Now it also
 * holds its estimate against the monthly cap forever, which eventually refuses
 * all work.
 */
export const STALE_BATCH_HOURS = 72;

/** Pure so the cutoff is testable without a clock or a database. */
export function isStaleBatch(
  submittedAt: Date,
  now: Date = new Date(),
  hours: number = STALE_BATCH_HOURS,
): boolean {
  return now.getTime() - submittedAt.getTime() >= hours * 3_600_000;
}

/** Transfer an unreadable batch's commitment once; the owner verifies its bill. */
export async function abandonStaleBatch(row: Batch): Promise<number> {
  return retainBatchUncertainty(
    row.providerBatchId,
    "Batch results remained unreadable past the stale cutoff; verify the provider bill before reconciling.",
  );
}

export async function markBatchStatus(
  providerBatchId: string,
  status: Batch["status"],
): Promise<void> {
  await db
    .update(batches)
    .set({ status, ...(status === "collected" ? { collectedAt: new Date() } : {}) })
    .where(
      and(
        eq(batches.providerBatchId, providerBatchId),
        inArray(batches.status, ["in_progress", "ended"]),
      ),
    );
}

/** The model a batch was submitted with, for pricing its results correctly. */
export async function batchModel(providerBatchId: string): Promise<AnalysisModel | null> {
  const [row] = await db
    .select({ model: batches.model })
    .from(batches)
    .where(eq(batches.providerBatchId, providerBatchId))
    .limit(1);
  return row && isAnalysisModel(row.model) ? row.model : null;
}

/**
 * Map the provider's job state onto ours.
 *
 * Only a job that reached SUCCEEDED has results to read, so that is the one
 * state this app calls collectable. Everything else — CANCELLING and PAUSED
 * included — is treated as still open: a job mid-cancel can still settle with
 * results, and calling it terminal early would drop rows that were already paid
 * for. A job that ends FAILED, CANCELLED or EXPIRED also stays open here and is
 * closed out by the stale-batch path instead, which bills the estimate on the
 * way (abandonStaleBatch) rather than forgiving a charge the provider very
 * likely made.
 */
export function mapProviderStatus(state: JobState | string | undefined): Batch["status"] {
  return state === JobState.JOB_STATE_SUCCEEDED ? "ended" : "in_progress";
}

/**
 * The human-readable reason a batch entry did not succeed.
 *
 * The status code is the point, not decoration: it is the actionable
 * discriminator (429 rate limit, 400 malformed request, 403 billing or
 * permission) and it is what tells a reader whether re-running the backfill has
 * any chance of a different answer. A message on its own reads much the same
 * for a transient failure and a permanent one — which was exactly the bug the
 * Anthropic version of this function was written to fix, and the reason it is
 * still a named function with its own tests rather than an inline template.
 */
export function batchFailureReason(error: JobError | undefined | null): string {
  const message = typeof error?.message === "string" ? error.message.trim() : "";
  const code = typeof error?.code === "number" ? String(error.code) : "unknown_error";
  return message ? `batch error: ${code}: ${message}` : `batch error: ${code}`;
}

export async function batchStatus(batchId: string): Promise<BatchJob> {
  return gemini().batches.get({ name: batchId });
}

/**
 * Wait for a batch to finish.
 *
 * Most batches complete within an hour; the API's own ceiling is 24. The
 * default timeout here is deliberately shorter than that — a cron-invoked
 * process should give up and let the next run collect the results rather than
 * hold a connection open for a day.
 */
export async function awaitBatch(
  batchId: string,
  options: { timeoutMs?: number; pollIntervalMs?: number; onPoll?: (s: string) => void } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;
  const pollIntervalMs = options.pollIntervalMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const batch = await batchStatus(batchId);
    options.onPoll?.(batch.state ?? "JOB_STATE_UNSPECIFIED");
    if (mapProviderStatus(batch.state) === "ended") return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }
}

/**
 * Read a finished batch and write one analyses row per result.
 *
 * Everything is keyed by the id this app put in the request metadata, never by
 * position. Gemini documents inlined responses as coming back in submission
 * order, but a silent reordering would attach each analysis to the wrong video
 * and no later check would catch it — which is not a bet worth taking to save a
 * map lookup.
 */
export async function collectBatchResults(
  batchId: string,
  options: { model?: AnalysisModel } = {},
): Promise<BatchOutcome> {
  const [stored] = await db
    .select({ model: batches.model, videoCount: batches.videoCount })
    .from(batches)
    .where(eq(batches.providerBatchId, batchId))
    .limit(1);
  const model =
    options.model ?? (stored && isAnalysisModel(stored.model) ? stored.model : DEFAULT_MODEL);
  const outcome: BatchOutcome = {
    succeeded: 0,
    failed: 0,
    expired: 0,
    alreadyWritten: 0,
    actualUsd: 0,
  };

  // The unique batch/video identity and atomic billing in insertAnalysis are
  // authoritative under concurrent collection. This set saves repeat writes.
  const alreadyWritten = new Map(
    (
      await db
        .select({ videoId: analyses.videoId, costUsd: analyses.costUsd })
        .from(analyses)
        .where(eq(analyses.batchId, batchId))
    ).map((row) => [row.videoId, Number(row.costUsd)] as const),
  );

  const job = await batchStatus(batchId);
  const entries = Array.isArray(job.dest?.inlinedResponses) ? job.dest.inlinedResponses : [];
  if (entries.length === 0 && mapProviderStatus(job.state) !== "ended") {
    throw new Error(
      "Batch " + batchId + " is not collectable yet (state: " + (job.state ?? "unknown") + ").",
    );
  }

  const unknownReasons = new Set<string>();
  const seenIds = new Set<number>();
  let unusableEntries = 0;
  const jobExpired = job.state === JobState.JOB_STATE_EXPIRED;
  if (entries.length === 0) {
    unknownReasons.add(
      job.dest?.fileName
        ? "The completed batch returned a file instead of usable inline billing results."
        : "The completed batch returned no usable inline billing results.",
    );
    outcome.failed += Math.max(1, stored?.videoCount ?? 0);
  }

  for (const entry of entries) {
    const videoId = parseCustomId(entry?.metadata?.[CUSTOM_ID_KEY]);
    if (videoId === null || seenIds.has(videoId)) {
      unknownReasons.add(
        videoId === null
          ? "A result lacked a usable video custom ID."
          : "Multiple results used the same video custom ID.",
      );
      unusableEntries += 1;
      outcome.failed += 1;
      continue;
    }
    seenIds.add(videoId);

    let usage: TokenUsage | undefined;
    let costUsd = 0;
    let billingError: string | undefined;
    if (entry.error || !entry.response) {
      billingError = batchFailureReason(entry.error);
      unknownReasons.add("One or more results reported an error or lacked a provider response.");
    } else {
      try {
        usage = readUsage(entry.response);
        if (!Object.values(usage).every((value) => Number.isFinite(value) && value >= 0)) {
          throw new Error("The provider reported invalid billing token counts.");
        }
        costUsd = estimateCostUsd(model, usage, { batch: true });
        if (!Number.isFinite(costUsd) || costUsd < 0) {
          throw new Error("The provider response could not be priced safely.");
        }
      } catch (error) {
        billingError = error instanceof Error ? error.message : String(error);
        unknownReasons.add("One or more responses lacked usable billing metadata.");
      }
    }

    // Classify billing before skipping a stored row: a prior zero-cost error
    // record is a trace of uncertainty, never proof that the request was free.
    if (alreadyWritten.has(videoId)) {
      if (!billingError && costUsd > 0 && alreadyWritten.get(videoId) === 0) {
        // A crash can leave the trace of an unknown response before recovery
        // transfers its commitment. A later billed result must not erase it.
        unknownReasons.add(
          "A stored zero-cost entry now has positive provider billing; owner reconciliation is required.",
        );
      }
      outcome.alreadyWritten += 1;
      continue;
    }
    if (billingError) {
      await insertAnalysis({
        videoId,
        model,
        status: "failed",
        error: (billingError + "; provider billing remains uncertain").slice(0, 1024),
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        costUsd: 0,
        batchId,
      });
      alreadyWritten.set(videoId, 0);
      if (jobExpired) outcome.expired += 1;
      else outcome.failed += 1;
      continue;
    }

    const raw = responseText(entry.response!);
    const parsed = parseAnalysisResponse(raw);
    await insertAnalysis({
      videoId,
      model,
      status: parsed.ok ? "ok" : "failed",
      payload: parsed.ok ? parsed.payload : undefined,
      error: parsed.ok ? undefined : parsed.error.slice(0, 1024),
      rawResponse: raw,
      usage: usage!,
      costUsd,
      batchId,
    });
    alreadyWritten.set(videoId, costUsd);
    outcome.actualUsd += costUsd;
    if (parsed.ok) outcome.succeeded += 1;
    else outcome.failed += 1;
  }

  if (stored && seenIds.size < stored.videoCount) {
    unknownReasons.add("The returned usable video IDs did not cover every submitted request.");
    if (entries.length)
      outcome.failed += Math.max(0, stored.videoCount - seenIds.size - unusableEntries);
  }

  if (unknownReasons.size) {
    const reason = [...unknownReasons].join(" ");
    const retainedUsd = await retainBatchUncertainty(batchId, reason);
    console.warn(
      "Batch " +
        batchId +
        " has unverified billing; recovery transfer added $" +
        retainedUsd.toFixed(6) +
        ". Check its terminal status and uncertainty record for owner reconciliation. " +
        reason,
    );
  } else {
    // A late collector cannot overwrite an uncertainty or completed latch.
    await markBatchStatus(batchId, "collected");
  }
  return outcome;
}

function parseCustomId(customId: unknown): number | null {
  if (typeof customId !== "string" || !/^video-[1-9]\d*$/.test(customId)) return null;
  const id = Number(customId.slice(CUSTOM_ID_PREFIX.length));
  return Number.isSafeInteger(id) && id <= 2_147_483_647 ? id : null;
}

/** Look up the videos a batch covered, for reporting. */
export async function videosByIds(ids: number[]): Promise<Video[]> {
  if (ids.length === 0) return [];
  return db.select().from(videos).where(inArray(videos.id, ids));
}

export async function videoById(id: number): Promise<Video | null> {
  const [row] = await db.select().from(videos).where(eq(videos.id, id)).limit(1);
  return row ?? null;
}
