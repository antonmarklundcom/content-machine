import { updateReturning } from "@/db/mutations";
/**
 * The poll run — find new uploads on tracked sources, fetch their captions, and
 * submit the analysis work as a Batch API job (PLAN.md §1.2).
 *
 * This lives in `src/lib` rather than in `scripts/poll-sources.ts` because two
 * callers need it: the CLI script, and the `/api/cron/poll` route handler that
 * Hostinger's cron hits over HTTP. The route handler must not shell out to the
 * script — a Next.js server process spawning `tsx` would double the memory
 * footprint on a shared Node slot, lose the error, and give the caller nothing
 * but an exit code.
 */

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { clips, sources, type Source } from "@/db/schema";
import {
  abandonStaleBatch,
  awaitBatch,
  batchStatus,
  collectBatchResults,
  isStaleBatch,
  mapProviderStatus,
  markBatchStatus,
  openBatches,
  submitAnalysisBatch,
  type BatchOutcome,
} from "@/lib/analysis/batch";
import { DEFAULT_MODEL, isAnalysisModel, type AnalysisModel } from "@/lib/analysis/pricing";
import { findPendingVideos } from "@/lib/analysis/run";
import { screeningEnabled } from "@/lib/screening/policy";
import { findUnscreenedVideos, screenVideos, type ScreenRunResult } from "@/lib/screening/run";
import { ingestRef } from "@/lib/ingest";
import {
  estimateBatchCostUsd,
  SpendCapExceededError,
  spendStatus,
  type SpendStatus,
} from "@/lib/spend";
import { runHealth, type StrategyHealthSnapshot } from "@/lib/youtube/captions";
import { YouTubeDataClient } from "@/lib/youtube/data-api";
import { QuotaExhaustedError } from "@/lib/youtube/quota";

export type PollOptions = {
  /** Newest N videos per source. */
  limit?: number;
  /** Cap on videos considered for analysis in one run. */
  pendingLimit?: number;
  /** [PR-35] Cap on videos screened in one run. */
  screenLimit?: number;
  /** [PR-35] Skip the gallring for this run, whatever SCREENING_ENABLED says. */
  screen?: boolean;
  /** Ingest only; leave analysis to the backfill. */
  analyze?: boolean;
  /**
   * Fetch captions for new videos (default true). The online deploy passes
   * false: YouTube blocks datacenter IPs, so caption polling stays on the PC
   * (PLAN.md §1.28, O14) and the online cron only finds new uploads.
   */
  captions?: boolean;
  /** Report what would be spent, submit nothing. */
  dryRun?: boolean;
  /** Block until the submitted batch finishes and write its results. */
  wait?: boolean;
  model?: AnalysisModel;
  onProgress?: (event: PollEvent) => void;
};

export type PollEvent =
  | { phase: "reaped"; count: number }
  | { phase: "sources"; count: number }
  | { phase: "source"; result: PollSourceResult }
  | { phase: "quota-exhausted"; message: string }
  | { phase: "collected"; batchId: string; outcome: BatchOutcome }
  | { phase: "batch-unreadable"; batchId: string; message: string }
  | { phase: "batch-abandoned"; batchId: string; estimatedUsd: number; message: string }
  | { phase: "screening"; count: number }
  | { phase: "screened"; result: ScreenRunResult }
  | { phase: "pending"; count: number }
  | { phase: "submitted"; batchId: string; videoCount: number; estimatedUsd: number }
  | { phase: "batch-status"; batchId: string; status: string };

export type PollSourceResult = {
  sourceId: number;
  title: string;
  kind: Source["kind"];
  videos: number;
  captions: { available: number; none: number; failed: number; skipped: number };
  error: string | null;
};

/**
 * Why no batch was submitted. `null` means one was.
 *
 * `batch-in-flight` is the one that matters for an unattended hourly cron:
 * videos stay "pending" until a batch's results are collected, so a second run
 * would happily re-submit the same transcripts and pay for them twice.
 */
export type PollSkipReason =
  | "no-analyze"
  | "nothing-pending"
  | "dry-run"
  | "batch-in-flight"
  | "no-usable-transcript"
  | "spend-cap";

export type PollResult = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** Clips stuck in `ingesting` that this run failed (PLAN.md §1.21). */
  reapedClips: number;
  sources: PollSourceResult[];
  quotaExhausted: boolean;
  /** Batches that had already ended and were written to `analyses` this run. */
  collected: Array<{ batchId: string; outcome: BatchOutcome }>;
  /** Batches given up on this run: unreadable for longer than STALE_BATCH_HOURS. */
  abandoned: Array<{ batchId: string; estimatedUsd: number }>;
  /**
   * [PR-35] What the gallring did before the work list was read. Null when it
   * did not run: screening off, a dry run, or nothing new to screen.
   */
  screening: ScreenRunResult | null;
  pendingAnalysis: number;
  submitted: { batchId: string; videoCount: number; estimatedUsd: number } | null;
  /** Set when `submitted` is null — includes the dry-run estimate. */
  skipped: { reason: PollSkipReason; detail: string; estimatedUsd?: number } | null;
  waited: { batchId: string; finished: boolean; outcome: BatchOutcome | null } | null;
  spend: { before: SpendStatus; after: SpendStatus };
  /**
   * Per-strategy caption health for this run. A run where every strategy shows
   * `retired` is the datacenter-IP diagnosis, visible without reading through
   * every per-video error — see docs/CAPTION-FETCH-RESILIENCE.md.
   */
  captionHealth: StrategyHealthSnapshot[];
};

export async function pollSources(options: PollOptions = {}): Promise<PollResult> {
  const {
    limit = 10,
    pendingLimit = 200,
    screenLimit = 100,
    analyze = true,
    captions = true,
    dryRun = false,
    wait = false,
    screen = screeningEnabled(),
    model = DEFAULT_MODEL,
    onProgress = () => {},
  } = options;

  const startedAt = new Date();
  const before = await spendStatus();

  // Before anything else, so a run that dies on its first source has still
  // done this. Cheap, free, and not part of what a dry run promises to skip.
  const reapedClips = await reapStuckClips();
  if (reapedClips > 0) onProgress({ phase: "reaped", count: reapedClips });

  const active = await db
    .select()
    .from(sources)
    .where(eq(sources.active, true))
    // Least-recently-polled first, so a run that dies partway still makes
    // progress across the whole set over successive runs.
    .orderBy(asc(sql`${sources.lastPolledAt} is null`), asc(sources.lastPolledAt));

  onProgress({ phase: "sources", count: active.length });

  // One client, therefore one QuotaTracker, for every source in this run.
  // Per-source clients each started their budget at zero, which made the guard
  // blind to a run that was collectively burning the daily allowance.
  const youtube = new YouTubeDataClient();

  const results: PollSourceResult[] = [];
  let quotaExhausted = false;

  for (const source of active) {
    try {
      const result = await pollSource(source, limit, youtube, captions);
      results.push(result);
      onProgress({ phase: "source", result });
    } catch (err) {
      if (err instanceof QuotaExhaustedError) {
        quotaExhausted = true;
        onProgress({ phase: "quota-exhausted", message: err.message });
        // Remaining sources are picked up next run — they sort first by then.
        break;
      }
      // One bad source must not abort the run; the others are independent.
      const result: PollSourceResult = {
        sourceId: source.id,
        title: source.title,
        kind: source.kind,
        videos: 0,
        captions: { available: 0, none: 0, failed: 0, skipped: 0 },
        error: err instanceof Error ? err.message : String(err),
      };
      results.push(result);
      onProgress({ phase: "source", result });
    }
  }

  // Filled by reconcileBatches below, and reported from every exit — like
  // `results` and `quotaExhausted`, giving up on a batch is something the run
  // did regardless of which branch it returns from.
  let abandoned: PollResult["abandoned"] = [];
  // Same treatment as `abandoned`: money was spent and videos were judged, so
  // it is reported from every exit rather than only from the one that submits.
  let screening: ScreenRunResult | null = null;

  const finish = async (
    partial: Pick<PollResult, "collected" | "pendingAnalysis" | "submitted" | "skipped" | "waited">,
  ): Promise<PollResult> => {
    const finishedAt = new Date();
    return {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      reapedClips,
      sources: results,
      quotaExhausted,
      abandoned,
      screening,
      spend: { before, after: await spendStatus() },
      captionHealth: runHealth().snapshot(),
      ...partial,
    };
  };

  const empty = { collected: [], pendingAnalysis: 0, submitted: null, waited: null };

  if (!analyze) {
    return finish({
      ...empty,
      skipped: { reason: "no-analyze", detail: "analysis disabled for this run" },
    });
  }

  // Collect anything that finished since the last run before deciding what is
  // still pending — a collected batch removes its videos from the pending set.
  // A dry run must not write analyses rows, so it only reads which batches are
  // still open.
  const reconciled = await reconcileBatches({ collect: !dryRun, onProgress });
  const collected = reconciled.collected;
  const inFlight = reconciled.inFlight;
  abandoned = reconciled.abandoned;

  // [PR-35] Gallringen, step 1. Runs before the work list is read, not after:
  // a video culled here never reaches findPendingVideos, which is the whole
  // saving. Skipped on a dry run because screening spends real money — a run
  // that promises to submit nothing must also buy nothing.
  if (screen && !dryRun) {
    const unscreened = await findUnscreenedVideos(screenLimit);
    if (unscreened.length > 0) {
      onProgress({ phase: "screening", count: unscreened.length });
      try {
        screening = await screenVideos(unscreened, { model });
        onProgress({ phase: "screened", result: screening });
      } catch (err) {
        // A cap that will not fund the screening will not fund the analysis
        // either, so this run has nothing to do — but say so from the analysis
        // path, which reports the cap properly. Swallowing it here and carrying
        // on costs one unscreened batch, not correctness.
        if (!(err instanceof SpendCapExceededError)) throw err;
      }
    }
  }

  const pending = await findPendingVideos(pendingLimit);
  onProgress({ phase: "pending", count: pending.length });

  if (pending.length === 0) {
    return finish({
      ...empty,
      collected,
      skipped: { reason: "nothing-pending", detail: "no video is awaiting analysis" },
    });
  }

  if (inFlight.length > 0) {
    return finish({
      ...empty,
      collected,
      pendingAnalysis: pending.length,
      skipped: {
        reason: "batch-in-flight",
        detail:
          `batch ${inFlight.join(", ")} is still processing; ` +
          "not submitting again so the same transcripts are not paid for twice",
      },
    });
  }

  if (dryRun) {
    // PLAN.md §1's reference video, since word counts aren't loaded until submit.
    const estimatedUsd = estimateBatchCostUsd(
      pending.map(() => 5_000),
      model,
      { batch: true },
    );
    return finish({
      ...empty,
      collected,
      pendingAnalysis: pending.length,
      skipped: { reason: "dry-run", detail: "nothing submitted", estimatedUsd },
    });
  }

  let submission;
  try {
    submission = await submitAnalysisBatch(pending, { model });
  } catch (err) {
    if (err instanceof SpendCapExceededError) {
      return finish({
        ...empty,
        collected,
        pendingAnalysis: pending.length,
        skipped: { reason: "spend-cap", detail: err.message },
      });
    }
    throw err;
  }

  if (!submission) {
    return finish({
      ...empty,
      collected,
      pendingAnalysis: pending.length,
      skipped: {
        reason: "no-usable-transcript",
        detail: "no pending video had a non-empty transcript",
      },
    });
  }

  const submitted = {
    batchId: submission.batchId,
    videoCount: submission.videoIds.length,
    estimatedUsd: submission.estimatedUsd,
  };
  onProgress({ phase: "submitted", ...submitted });

  if (!wait) {
    return finish({
      collected,
      pendingAnalysis: pending.length,
      submitted,
      skipped: null,
      waited: null,
    });
  }

  const finished = await awaitBatch(submission.batchId, {
    onPoll: (status) => onProgress({ phase: "batch-status", batchId: submission!.batchId, status }),
  });
  const outcome = finished ? await collectBatchResults(submission.batchId, { model }) : null;

  return finish({
    collected,
    pendingAnalysis: pending.length,
    submitted,
    skipped: null,
    waited: { batchId: submission.batchId, finished, outcome },
  });
}

/** How long a clip may sit in `ingesting` before the poll run calls it dead. */
export const CLIP_INGEST_TIMEOUT_MINUTES = 15;
export const CLIP_INGEST_TIMEOUT_ERROR = "Ingest timed out — retry";

/**
 * Fail clips stuck in `ingesting` (PLAN.md §1.21). A clip gets there when the
 * save route hands a YouTube link to ingest, and leaves when ingest finishes —
 * so a process killed in between (a closed laptop lid, a restarted dev server)
 * strands it for good, with no retry button, since the inbox offers retry only
 * on `failed`. Failing it with a retryable error puts it back in reach.
 *
 * One statement, time compared in SQL, same reason as the lease: the database
 * clock is the only one every caller shares.
 */
export async function reapStuckClips(): Promise<number> {
  const reaped = await updateReturning(
    db,
    clips,
    { status: "failed", error: CLIP_INGEST_TIMEOUT_ERROR },
    and(
      eq(clips.status, "ingesting"),
      // When ingest started, not when the link was saved: a retry of an
      // old clip is fresh. Rows from before the column fall back to saved_at.
      sql`coalesce(${clips.ingestStartedAt}, ${clips.savedAt}) < date_sub(now(), interval ${CLIP_INGEST_TIMEOUT_MINUTES} minute)`,
    ),
    { id: clips.id },
  );
  return reaped.length;
}

async function pollSource(
  source: Source,
  limit: number,
  client: YouTubeDataClient,
  captions = true,
): Promise<PollSourceResult> {
  const ref =
    source.kind === "channel"
      ? ({ kind: "channel", channelId: source.youtubeId } as const)
      : ({ kind: "playlist", playlistId: source.youtubeId } as const);

  const summary = await ingestRef(ref, { limit, skipCaptions: !captions, client });

  await db.update(sources).set({ lastPolledAt: new Date() }).where(eq(sources.id, source.id));

  return {
    sourceId: source.id,
    title: source.title,
    kind: source.kind,
    videos: summary.videos.length,
    captions: {
      available: summary.captionCounts.available,
      none: summary.captionCounts.none,
      failed: summary.captionCounts.failed,
      skipped: summary.captionCounts.skipped,
    },
    error: null,
  };
}

/**
 * Bring every batch this app has submitted up to date, and write the results of
 * any that have finished.
 *
 * This walks rows in `batches` and retrieves each by id. It used to walk
 * `messages.batches.list()` filtered to the last 24 hours, which had two holes:
 * a batch stranded by an outage longer than the API's own 24-hour window became
 * invisible and its cost was simply lost, and every batch belonging to any
 * other project sharing the API key showed up here and postponed submissions.
 * Both disappear once this app's own database is the ledger.
 *
 * A batch that cannot be read — deleted, expired past the retention window, or
 * a provider error — must not abort the run: the other batches, and the ingest
 * work already done above it, are independent.
 */
async function reconcileBatches(options: {
  collect: boolean;
  onProgress: (event: PollEvent) => void;
}): Promise<{
  collected: Array<{ batchId: string; outcome: BatchOutcome }>;
  abandoned: Array<{ batchId: string; estimatedUsd: number }>;
  inFlight: string[];
}> {
  const collected: Array<{ batchId: string; outcome: BatchOutcome }> = [];
  const abandoned: Array<{ batchId: string; estimatedUsd: number }> = [];
  const inFlight: string[] = [];

  for (const row of await openBatches()) {
    const id = row.providerBatchId;
    let status: string;
    try {
      status = mapProviderStatus((await batchStatus(id)).state);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Transient failures leave the row open — the next run collects it. But a
      // row that has been unreadable for STALE_BATCH_HOURS is not late, and
      // retrying it forever both spams the log and (since PR-26) holds its
      // estimate against the cap for good. Give up, and bill the estimate so
      // giving up does not also forgive the charge.
      if (isStaleBatch(row.submittedAt)) {
        const estimatedUsd = await abandonStaleBatch(row);
        abandoned.push({ batchId: id, estimatedUsd });
        options.onProgress({ phase: "batch-abandoned", batchId: id, estimatedUsd, message });
        continue;
      }
      options.onProgress({ phase: "batch-unreadable", batchId: id, message });
      inFlight.push(id);
      continue;
    }

    if (status !== "ended") {
      if (row.status !== "in_progress") await markBatchStatus(id, "in_progress");
      inFlight.push(id);
      continue;
    }

    if (!options.collect) {
      if (row.status !== "ended") await markBatchStatus(id, "ended");
      // Ended but uncollected still blocks submission: its videos are paid for
      // and would otherwise be re-submitted by the next non-dry run.
      inFlight.push(id);
      continue;
    }

    const model = isAnalysisModel(row.model) ? row.model : DEFAULT_MODEL;
    const outcome = await collectBatchResults(id, { model });
    collected.push({ batchId: id, outcome });
    options.onProgress({ phase: "collected", batchId: id, outcome });
  }

  return { collected, abandoned, inFlight };
}
