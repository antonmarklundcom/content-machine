import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { analyses, transcripts, videos } from "@/db/schema";
import {
  analyzeVideoUrl,
  estimateVideoUrlAnalysisCostUsd,
  readUsage,
  responseText,
  VideoUrlAnalysisRefusedError,
} from "@/lib/ai";
import { analysisPromptVersion } from "./contract";
import { parseAnalysisResponse } from "./parse";
import { estimateCostUsd, type AnalysisModel } from "./pricing";
import { insertAnalysis, type AnalyzeResult } from "./run";

/**
 * The no-captions fallback (PLAN.md §1.35): analyse a video that has no
 * transcript by handing Gemini its YouTube URL.
 *
 * Owner click only. Nothing in poll, backfill or batch imports this module —
 * a video with no captions is the common case for a whole class of channels,
 * and paying ~10x a caption analysis for each of them unattended is exactly
 * what the cap would then be spent on. Same output parsing and the same
 * `insertAnalysis` as the caption path, so a fallback analysis is an ordinary
 * `analyses` row to everything downstream (digest, tags, promote, spend).
 */

export { VideoUrlAnalysisRefusedError as FallbackRefusedError };

export class FallbackNotFoundError extends Error {
  constructor(videoId: number) {
    super(`No video with id ${videoId}.`);
    this.name = "FallbackNotFoundError";
  }
}

export type FallbackEstimate =
  { ok: true; estimatedUsd: number; durationSeconds: number } | { ok: false; reason: string };

/** What a fallback analysis of this video would reserve, or why it would be refused — for the confirm step. */
export async function fallbackEstimate(videoId: number): Promise<FallbackEstimate> {
  const [video] = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
  if (!video) return { ok: false, reason: new FallbackNotFoundError(videoId).message };
  const refusal = await transcriptRefusal(videoId);
  if (refusal) return { ok: false, reason: refusal };
  try {
    return {
      ok: true,
      estimatedUsd: estimateVideoUrlAnalysisCostUsd(video.durationSeconds),
      durationSeconds: video.durationSeconds!,
    };
  } catch (err) {
    if (err instanceof VideoUrlAnalysisRefusedError) return { ok: false, reason: err.message };
    throw err;
  }
}

/** A transcript makes the fallback pointless: the caption path reads it for a tenth of the price. */
async function transcriptRefusal(videoId: number): Promise<string | null> {
  const [transcript] = await db
    .select({ id: transcripts.id, content: transcripts.content })
    .from(transcripts)
    .where(eq(transcripts.videoId, videoId))
    .limit(1);
  return transcript?.content.trim()
    ? "This video has a transcript — use the normal analysis, which reads it for a fraction of the cost."
    : null;
}

export type FallbackOptions = {
  model?: AnalysisModel;
  /** Analyse again even when a successful analysis already exists. */
  force?: boolean;
};

/**
 * Analyse a caption-less video from its YouTube URL and store the result like
 * any other analysis. Throws FallbackRefusedError when the duration is unknown,
 * over 90 minutes, or the video has a transcript; SpendCapExceededError at the cap.
 */
export async function analyzeWithoutCaptions(
  videoId: number,
  options: FallbackOptions = {},
): Promise<AnalyzeResult> {
  const [video] = await db.select().from(videos).where(eq(videos.id, videoId)).limit(1);
  if (!video) throw new FallbackNotFoundError(videoId);

  if (!options.force) {
    const [existing] = await db
      .select({ id: analyses.id })
      .from(analyses)
      .where(and(eq(analyses.videoId, video.id), eq(analyses.status, "ok")))
      .orderBy(desc(analyses.id))
      .limit(1);
    if (existing) return { status: "skipped", why: "already-analysed" };
  }

  const refusal = await transcriptRefusal(video.id);
  if (refusal) throw new VideoUrlAnalysisRefusedError(refusal);

  const promptVersion = analysisPromptVersion(undefined);

  return analyzeVideoUrl(
    {
      youtubeUrl: `https://www.youtube.com/watch?v=${video.youtubeId}`,
      durationSeconds: video.durationSeconds,
      title: video.title,
      channelTitle: video.channelTitle,
      model: options.model,
    },
    async (outcome): Promise<AnalyzeResult> => {
      if (!outcome.ok) {
        // No usage on an API error, so no cost — but a row, so the failure is visible.
        const row = await insertAnalysis({
          videoId: video.id,
          model: outcome.model,
          promptVersion,
          status: "failed",
          error: `api error (video url): ${outcome.error}`.slice(0, 1024),
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          costUsd: 0,
        });
        return { status: "failed", analysis: row, error: outcome.error, costUsd: 0 };
      }

      const usage = readUsage(outcome.response);
      const costUsd = estimateCostUsd(outcome.model, usage);
      const raw = responseText(outcome.response);
      const truncated = outcome.response.candidates?.[0]?.finishReason === "MAX_TOKENS";
      const parsed = truncated ? null : parseAnalysisResponse(raw);

      if (!parsed || !parsed.ok) {
        const error = parsed ? parsed.error : "response hit maxOutputTokens; output truncated";
        const row = await insertAnalysis({
          videoId: video.id,
          model: outcome.model,
          promptVersion,
          status: "failed",
          error: error.slice(0, 1024),
          rawResponse: raw,
          usage,
          costUsd,
        });
        return { status: "failed", analysis: row, error, costUsd };
      }

      const row = await insertAnalysis({
        videoId: video.id,
        model: outcome.model,
        promptVersion,
        status: "ok",
        payload: parsed.payload,
        rawResponse: raw,
        usage,
        costUsd,
      });
      return { status: "ok", analysis: row, payload: parsed.payload, costUsd };
    },
  );
}
