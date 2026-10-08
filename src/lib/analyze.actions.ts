"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { transcripts, videos } from "@/db/schema";
import { openBatches, submitAnalysisBatch } from "@/lib/analysis/batch";
import { analyzeVideo, findPendingVideosByIds } from "@/lib/analysis/run";
import { BULK_ANALYZE_LIMIT, parseVideoIds } from "@/lib/bulk-select";
import { ForbiddenError } from "@/lib/auth/roles";
import { requireOwner } from "@/lib/auth/session";
import { DEFAULT_MODEL, isAnalysisModel, type AnalysisModel } from "@/lib/analysis/pricing";
import {
  estimateAnalysisCostUsd,
  formatUsd,
  SpendCapExceededError,
  withSpendCap,
} from "@/lib/spend";

/**
 * Analysis from the UI (PLAN.md §9 PR-17).
 *
 * `analyzeVideo()` has existed since PR-06 and nothing in the app called it —
 * the only way to analyse a stored video was the CLI backfill. This is the
 * missing wire, not new pipeline code: the estimate/cap/analyse sequence is the
 * same one `submitIngest` already performs for a single-video paste.
 */

export type AnalyzeActionResult = { ok: true; message: string } | { ok: false; error: string };

export type AnalyzeActionOptions = {
  /** Model id; anything unrecognised falls back to the default rather than throwing. */
  model?: string;
  /** Re-analyse a video that already has a successful analysis. */
  force?: boolean;
};

export async function analyzeVideoAction(
  videoId: number,
  options: AnalyzeActionOptions = {},
): Promise<AnalyzeActionResult> {
  const model = options.model && isAnalysisModel(options.model) ? options.model : DEFAULT_MODEL;

  try {
    await requireOwner("start an analysis");

    const [video] = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
    if (!video) return { ok: false, error: "No such video." };

    const [transcript] = await db
      .select({ wordCount: transcripts.wordCount })
      .from(transcripts)
      .where(eq(transcripts.videoId, videoId))
      .limit(1);
    if (!transcript) {
      return { ok: false, error: "No stored transcript, so there is nothing to analyse." };
    }

    // The cap is checked before the call, not after the bill (PR-07), and held
    // for the duration of the call so a concurrent request can't slip through
    // the same gap (see withSpendCap).
    const result = await withSpendCap(estimateAnalysisCostUsd(transcript.wordCount, model), () =>
      analyzeVideo(video, { model, force: options.force }),
    );

    revalidatePath("/youtube");
    revalidatePath(`/youtube/video/${videoId}`);

    if (result.status === "ok") {
      return { ok: true, message: `Analysed for ${formatUsd(result.costUsd)}.` };
    }
    if (result.status === "skipped") {
      return result.why === "already-analysed"
        ? { ok: true, message: "Already analysed — nothing was spent." }
        : { ok: false, error: "No stored transcript, so there is nothing to analyse." };
    }
    return { ok: false, error: result.error };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    if (err instanceof SpendCapExceededError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Analysis failed." };
  }
}

/**
 * Analyse a selection from the feed (PR-28).
 *
 * Submitted through the Batch API rather than one interactive call per video:
 * forty videos is forty minutes of blocking work at the interactive path, which
 * no server action survives, and the batch path is half the price for work
 * nobody is waiting on. The results land the same way the poller's do — the
 * next collection writes them.
 *
 * Takes FormData because the control is a plain form of checkboxes; the ids are
 * re-filtered server-side (`findPendingVideosByIds`) rather than trusted, since
 * a form post is a public endpoint.
 */
export type BulkAnalyzeState = { ok: true; message: string } | { ok: false; error: string } | null;

export async function analyzeSelectedAction(
  _prev: BulkAnalyzeState,
  formData: FormData,
): Promise<BulkAnalyzeState> {
  try {
    await requireOwner("start an analysis");

    const model = readModel(formData.get("model"));
    const ids = parseVideoIds(formData.getAll("videoId"));
    if (ids.length === 0) return { ok: false, error: "Nothing selected." };
    if (ids.length > BULK_ANALYZE_LIMIT) {
      return {
        ok: false,
        error: `Select at most ${BULK_ANALYZE_LIMIT} videos at once.`,
      };
    }

    // One batch at a time, for the same reason the poller skips while one is in
    // flight: a submitted batch's videos still look pending until its results
    // are collected, so a second submission pays for the same transcripts twice.
    const open = await openBatches();
    if (open.length > 0) {
      return {
        ok: false,
        error:
          `A batch (${open[0]!.providerBatchId}) is still processing. ` +
          "Its videos still count as pending, so submitting now would pay for some of them twice. " +
          "Wait for the next poll to collect it.",
      };
    }

    const pending = await findPendingVideosByIds(ids);
    if (pending.length === 0) {
      return {
        ok: false,
        error: "Nothing to do — every selected video is already analysed or has no transcript.",
      };
    }

    const submission = await submitAnalysisBatch(pending, { model });
    if (!submission) {
      return { ok: false, error: "No selected video had a usable transcript." };
    }

    revalidatePath("/youtube");
    const skipped = ids.length - submission.videoIds.length;
    return {
      ok: true,
      message:
        `Submitted ${submission.videoIds.length} video(s) as batch ${submission.batchId}, ` +
        `estimated ${formatUsd(submission.estimatedUsd)}. Results appear once the batch is ` +
        `collected — the hourly poll does that, or run \`npm run poll -- --collect\`.` +
        (skipped > 0 ? ` ${skipped} selected video(s) needed no work.` : ""),
    };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: err.message };
    if (err instanceof SpendCapExceededError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : "Submission failed." };
  }
}

function readModel(raw: FormDataEntryValue | null): AnalysisModel {
  return typeof raw === "string" && isAnalysisModel(raw) ? raw : DEFAULT_MODEL;
}
