import { insertReturning, isDuplicateKey } from "@/db/mutations";
import { ThinkingLevel, type GenerateContentResponse, type GoogleGenAI } from "@google/genai";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { analyses, transcripts, videos, type Analysis, type Video } from "@/db/schema";
import { geminiClient, readUsage, responseText } from "@/lib/ai";
import { analysisPromptVersion, ANALYSIS_PROMPT_VERSION, type AnalysisPayload } from "./contract";
import { parseAnalysisResponse } from "./parse";
import {
  DEFAULT_MODEL,
  estimateCostUsd,
  toCostString,
  type AnalysisModel,
  type TokenUsage,
} from "./pricing";
import { ANALYSIS_JSON_SCHEMA, ANALYSIS_SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import { completeSpendCommit, dispatchSpend, recordSpend } from "@/lib/spend";
import { syncVideoTags } from "@/lib/tags";
import { screenMinScore } from "@/lib/screening/policy";
import { notCulled } from "@/lib/screening/sql";

/**
 * The analysis pipeline (PLAN.md §5 row 06): transcript -> Gemini 3.1
 * Flash-Lite -> validated JSON -> analyses row, with tokens and cost recorded
 * per row.
 */

/** ~2,500 output tokens expected (PLAN.md §1); the headroom absorbs long videos. */
export const MAX_OUTPUT_TOKENS = 8_000;

/**
 * Reasoning is off across this pipeline.
 *
 * Gemini bills reasoning tokens at the output rate AND counts them against
 * `maxOutputTokens`, so a model left to think freely can spend the whole
 * budget before it writes a character of the JSON — the screening path, with
 * its 400-token ceiling, would truncate every time. The Anthropic models this
 * replaced were called without extended thinking at all, so MINIMAL is the
 * faithful port as well as the cheap one. If analyses ever come back thin,
 * this is the lever (see KNOWN-ISSUES.md).
 */
export const THINKING_LEVEL = ThinkingLevel.MINIMAL;

/** Re-exported so the analysis/screening/outline modules share one Gemini client. */
export function gemini(): GoogleGenAI {
  return geminiClient();
}

/** Re-exported from the one module that knows how Gemini shapes a response. */
export { readUsage, responseText };

export type AnalyzeOptions = {
  model?: AnalysisModel;
  /** Analyse again even when a successful analysis already exists. */
  force?: boolean;
  /**
   * Output language (PR-22b). Absent or "en" produces byte-identical prompts to
   * every analysis already stored, and keeps prompt_version at 1. Nothing sets
   * this yet — there is no UI and no setting.
   */
  language?: string;
};

export type AnalyzeResult =
  | { status: "ok"; analysis: Analysis; payload: AnalysisPayload; costUsd: number }
  | { status: "failed"; analysis: Analysis; error: string; costUsd: number }
  | { status: "skipped"; why: "already-analysed" | "no-transcript" };

export async function analyzeVideo(
  video: Video,
  options: AnalyzeOptions = {},
): Promise<AnalyzeResult> {
  const model = options.model ?? DEFAULT_MODEL;
  const promptVersion = analysisPromptVersion(options.language);

  if (!options.force) {
    const [existing] = await db
      .select({ id: analyses.id })
      .from(analyses)
      .where(and(eq(analyses.videoId, video.id), eq(analyses.status, "ok")))
      .orderBy(desc(analyses.id))
      .limit(1);
    // "Analyse once, store forever" (PLAN.md §1.3) — re-reading a stored
    // analysis costs $0, so never pay twice by accident.
    if (existing) return { status: "skipped", why: "already-analysed" };
  }

  const [transcript] = await db
    .select()
    .from(transcripts)
    .where(eq(transcripts.videoId, video.id))
    .limit(1);
  if (!transcript || !transcript.content.trim()) {
    return { status: "skipped", why: "no-transcript" };
  }

  let response: GenerateContentResponse;

  try {
    response = await dispatchSpend(() =>
      gemini().models.generateContent({
        model,
        contents: buildUserPrompt({
          title: video.title,
          channelTitle: video.channelTitle,
          durationSeconds: video.durationSeconds,
          transcript: transcript.content,
          language: options.language,
        }),
        config: {
          // The fixed template. There is no cache breakpoint to set on Gemini —
          // caching is implicit and needs a shared prefix of at least 4096
          // tokens, which this prompt does not reach (see CACHE_NOTE).
          systemInstruction: ANALYSIS_SYSTEM_PROMPT,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          thinkingConfig: { thinkingLevel: THINKING_LEVEL },
          // Structured outputs constrain the model to the §4 shape rather than
          // merely asking for it. The defensive parser stays as a backstop.
          responseMimeType: "application/json",
          responseJsonSchema: ANALYSIS_JSON_SCHEMA,
        },
      }),
    );
  } catch (err) {
    // An API-level failure produces no usage, so it costs nothing and must not
    // write a cost row — but it must still be recorded, or the backfill retries
    // it forever with no trace of why.
    const message = err instanceof Error ? err.message : String(err);
    const row = await insertAnalysis({
      videoId: video.id,
      model,
      promptVersion,
      status: "failed",
      error: `api error: ${message}`.slice(0, 1024),
      usage: EMPTY_USAGE,
      costUsd: 0,
    });
    return { status: "failed", analysis: row, error: message, costUsd: 0 };
  }

  const usage = readUsage(response);
  const costUsd = estimateCostUsd(model, usage);
  const raw = responseText(response);

  if (response.candidates?.[0]?.finishReason === "MAX_TOKENS") {
    // Truncated JSON parses as garbage; naming the real cause saves a debugging
    // session when it happens on an unusually long transcript.
    const row = await insertAnalysis({
      videoId: video.id,
      model,
      promptVersion,
      status: "failed",
      error: `response hit maxOutputTokens (${MAX_OUTPUT_TOKENS}); output truncated`,
      rawResponse: raw,
      usage,
      costUsd,
    });
    return { status: "failed", analysis: row, error: "MAX_TOKENS", costUsd };
  }

  const parsed = parseAnalysisResponse(raw);
  if (!parsed.ok) {
    // PLAN.md §4: store the raw response and mark the row failed rather than
    // crashing the batch.
    const row = await insertAnalysis({
      videoId: video.id,
      model,
      promptVersion,
      status: "failed",
      error: parsed.error.slice(0, 1024),
      rawResponse: raw,
      usage,
      costUsd,
    });
    return { status: "failed", analysis: row, error: parsed.error, costUsd };
  }

  const row = await insertAnalysis({
    videoId: video.id,
    model,
    promptVersion,
    status: "ok",
    payload: parsed.payload,
    rawResponse: raw,
    usage,
    costUsd,
  });

  return { status: "ok", analysis: row, payload: parsed.payload, costUsd };
}

const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

export async function insertAnalysis(input: {
  videoId: number;
  model: AnalysisModel;
  /** Defaults to the English prompt's version; see analysisPromptVersion(). */
  promptVersion?: number;
  status: "ok" | "failed";
  payload?: AnalysisPayload;
  rawResponse?: string;
  error?: string;
  usage: TokenUsage;
  costUsd: number;
  batchId?: string;
}): Promise<Analysis> {
  const { payload } = input;

  // Persist the purchased result and its spend in one commit. A batch entry's
  // unique (batch_id, video_id) identity also makes overlapping collectors safe.
  const { result, fresh } = await db.transaction(async (tx) => {
    let row: Analysis | undefined;
    try {
      [row] = await insertReturning(tx, analyses, {
        videoId: input.videoId,
        model: input.model,
        promptVersion: input.promptVersion ?? ANALYSIS_PROMPT_VERSION,
        status: input.status,
        summary: payload?.summary ?? null,
        takeaways: payload?.takeaways ?? null,
        hookBreakdown: payload?.hook ?? null,
        timeline: payload?.timeline ?? null,
        gaps: payload?.gaps ?? null,
        ideas: payload?.ideas ?? null,
        // [PR-34] The analysis's own immutable copy. Null on a failed row, and on
        // any row written before the contract carried these fields.
        topics: payload?.topics ?? null,
        entities: payload?.entities ?? null,
        contentType: payload?.content_type || null,
        rawResponse: input.rawResponse ?? null,
        error: input.error ?? null,
        batchId: input.batchId ?? null,
        inputTokens: input.usage.inputTokens,
        outputTokens: input.usage.outputTokens,
        cacheReadTokens: input.usage.cacheReadTokens,
        cacheWriteTokens: input.usage.cacheWriteTokens,
        costUsd: toCostString(input.costUsd),
      });
    } catch (error) {
      const batchId = input.batchId;
      if (!batchId || !isDuplicateKey(error)) throw error;
      // A locking read sees the collector that won even in a pre-existing
      // REPEATABLE READ snapshot. Do not suppress other unique-key failures.
      const [existing] = await tx
        .select()
        .from(analyses)
        .where(and(eq(analyses.batchId, batchId), eq(analyses.videoId, input.videoId)))
        .limit(1)
        .for("update");
      if (!existing) throw error;
      return { result: existing, fresh: false };
    }
    if (!row) throw new Error("Insert into analyses returned no row");
    // Keep ledger errors outside duplicate handling: a failed charge must roll
    // back the result so a retry cannot mistake it for an already billed entry.
    await recordSpend(input.costUsd, new Date(), tx);
    return { result: row, fresh: true };
  });

  // Clear the active verified dispatch only after its durable transaction
  // commits. A failed request without a response remains uncertain.
  if (Number.isFinite(input.costUsd) && input.costUsd >= 0) completeSpendCommit();
  if (!fresh) return result;

  // [PR-34] Retag the video from this analysis. Every write path — interactive,
  // backfill and batch collection — funnels through here, so this is the one
  // place that can guarantee the lookup tables never drift from the analyses.
  //
  // Only on success, and only when the payload carries the fields: a failed row
  // has no opinion about what the video is about, and clearing a video's tags
  // because one re-analysis errored would lose grouping the owner already paid
  // for.
  //
  // Deliberately outside the spend recording above and tolerant of its own
  // failure: the analysis is bought and stored by this point, and losing the
  // whole row — along with the money — because a tag insert deadlocked would
  // trade a real asset for a derived index that the next analysis rebuilds.
  if (input.status === "ok" && payload && (payload.topics.length || payload.entities.length)) {
    try {
      await syncVideoTags(input.videoId, { topics: payload.topics, entities: payload.entities });
    } catch (err) {
      console.warn(
        `analysis ${result.id} stored, but tagging video ${input.videoId} failed: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  return result;
}

/**
 * Videos with a transcript and no successful analysis — the backfill's work list.
 *
 * NOT EXISTS rather than a LEFT JOIN: a video can have several analysis rows
 * (append-only, plus failed retries), and a join would emit one row per
 * analysis and need de-duplicating in code.
 */
/**
 * The same "pending" definition as findPendingVideos, restricted to an explicit
 * set of ids (PR-28).
 *
 * Bulk analysis takes its ids from a form, which is a public endpoint: the
 * filter is what stops a hand-edited request from re-paying for videos that are
 * already analysed, or from submitting ones with no transcript at all.
 */
export async function findPendingVideosByIds(ids: number[]): Promise<Video[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(videos)
    .where(
      and(
        inArray(videos.id, ids),
        eq(videos.captionStatus, "available"),
        sql`exists (select 1 from ${transcripts} where ${transcripts.videoId} = ${videos.id})`,
        sql`not exists (
          select 1 from ${analyses}
          where ${analyses.videoId} = ${videos.id} and ${analyses.status} = 'ok'
        )`,
        // [PR-35] and not culled by the gallring. Applied here as well as in
        // findPendingVideos because this is the path a form posts ids into: a
        // hand-edited request must not be able to buy an analysis the screen
        // already declined to buy. The feed does not offer culled videos for
        // selection, so nothing legitimate reaches this filter.
        notCulled(screenMinScore()),
      ),
    )
    .orderBy(desc(sql`${videos.publishedAt} is null`), desc(videos.publishedAt));
}

export async function findPendingVideos(limit = 50): Promise<Video[]> {
  return db
    .select()
    .from(videos)
    .where(
      and(
        eq(videos.captionStatus, "available"),
        sql`exists (select 1 from ${transcripts} where ${transcripts.videoId} = ${videos.id})`,
        sql`not exists (
          select 1 from ${analyses}
          where ${analyses.videoId} = ${videos.id} and ${analyses.status} = 'ok'
        )`,
        // [PR-35] The gallring. A video screened below SCREEN_MIN_SCORE leaves
        // the work list without being marked failed or unanalysable — it is
        // still analysable, and one click on its page still buys the analysis.
        // It simply stops being something the unattended poll run pays for,
        // which is the entire saving.
        notCulled(screenMinScore()),
      ),
    )
    .orderBy(desc(sql`${videos.publishedAt} is null`), desc(videos.publishedAt))
    .limit(limit);
}
