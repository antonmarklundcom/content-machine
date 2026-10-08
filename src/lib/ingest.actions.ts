"use server";
import { upsertReturning } from "@/db/mutations";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { transcripts, type Video } from "@/db/schema";
import { analyzeVideo } from "@/lib/analysis/run";
import { isOwner } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { DEFAULT_MODEL } from "@/lib/analysis/pricing";
import {
  estimateAnalysisCostUsd,
  formatUsd,
  SpendCapExceededError,
  withSpendCap,
} from "@/lib/spend";
import { ingestUrl } from "@/lib/ingest";
import { BULK_INGEST_LIMIT } from "@/lib/ingest/limits";
import { upsertVideoFromMetadata } from "@/lib/ingest/store";
import { parseYouTubeUrl } from "@/lib/youtube/url";
import { YouTubeDataClient } from "@/lib/youtube/data-api";

/**
 * Three outcomes, not two (PR-21). "Ingested 25 videos, none analysed" and
 * "Analysed for $0.02" are both `ok: true` and mean very different things — the
 * first is a to-do, the second is done. Rendering them identically in accent
 * green trained the eye to stop reading them.
 */
export type IngestFormResult =
  | { ok: true; tone: "success" | "info"; message: string }
  | { ok: false; tone: "error"; error: string };

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export async function submitIngest(
  _prev: IngestFormResult | null,
  formData: FormData,
): Promise<IngestFormResult> {
  const url = String(formData.get("url") ?? "").trim();
  const transcriptText = String(formData.get("transcript") ?? "").trim();

  if (!url) return { ok: false, tone: "error", error: "Paste a YouTube URL." };
  const ref = parseYouTubeUrl(url);
  if (!ref) return { ok: false, tone: "error", error: "Not a recognisable YouTube URL." };

  // PLAN.md §9 PR-24: an employee keeps metadata ingest — it is free — but the
  // analyse step at the end of the single-video path spends money, so for them
  // this action stops after storing the video.
  const canSpend = isOwner(await getSession());

  try {
    if (ref.kind !== "video" && transcriptText) {
      return {
        ok: false,
        tone: "error",
        error: "A pasted transcript only applies to a single video URL.",
      };
    }

    let video: Video;

    if (transcriptText) {
      // Manual transcript: store metadata only, skip the caption pipeline
      // entirely, and write the transcript with source='manual'.
      const client = new YouTubeDataClient();
      const resolved = await client.resolve(ref);
      if (!resolved || resolved.kind !== "video") {
        return { ok: false, tone: "error", error: "YouTube returned no such video." };
      }
      video = await upsertVideoFromMetadata(resolved.video, null);

      const words = wordCount(transcriptText);
      await upsertReturning(
        db,
        transcripts,
        {
          videoId: video.id,
          language: null,
          source: "manual",
          wordCount: words,
          content: transcriptText,
        },
        {
          target: transcripts.videoId,
          set: { source: "manual", wordCount: words, content: transcriptText },
        },
      );
    } else if (ref.kind === "video") {
      const summary = await ingestUrl(url);
      const [stored] = summary.videos;
      if (!stored) {
        return { ok: false, tone: "error", error: "Could not fetch this video's metadata." };
      }
      video = stored;
    } else {
      // Playlist or channel: ingest and report a summary. No auto-analyse —
      // that could be dozens of paid API calls from one form submit.
      const summary = await ingestUrl(url, { limit: BULK_INGEST_LIMIT });
      revalidatePath("/youtube");
      revalidatePath("/youtube/sources");
      return {
        ok: true,
        // Ingested but unanalysed: work remains, so this is information, not
        // a success.
        tone: "info",
        message:
          `Ingested ${summary.videos.length} video(s). Captions: ` +
          `${summary.captionCounts.available} available, ${summary.captionCounts.none} none, ` +
          `${summary.captionCounts.failed} failed. Analyse them from the digest feed.`,
      };
    }

    if (!canSpend) {
      revalidatePath("/youtube");
      return {
        ok: true,
        tone: "info",
        message: `Ingested "${video.title}". Analysis has to be started by the owner.`,
      };
    }

    // Direct-analyse: only reachable for a single video (URL or manual paste).
    const [transcriptRow] = await db
      .select({ wordCount: transcripts.wordCount })
      .from(transcripts)
      .where(eq(transcripts.videoId, video.id))
      .limit(1);

    if (!transcriptRow) {
      revalidatePath("/youtube");
      return {
        ok: true,
        tone: "info",
        message: `Ingested "${video.title}" — no transcript available to analyse.`,
      };
    }

    const estimatedUsd = estimateAnalysisCostUsd(transcriptRow.wordCount, DEFAULT_MODEL);
    const result = await withSpendCap(estimatedUsd, () => analyzeVideo(video));
    revalidatePath("/youtube");
    revalidatePath(`/youtube/video/${video.id}`);

    if (result.status === "ok") {
      return {
        ok: true,
        tone: "success",
        message: `Analysed "${video.title}" for ${formatUsd(result.costUsd)}.`,
      };
    }
    if (result.status === "skipped") {
      return {
        ok: true,
        tone: "info",
        message: `"${video.title}" ingested — ${result.why.replace("-", " ")}.`,
      };
    }
    return { ok: false, tone: "error", error: `Analysis failed: ${result.error}` };
  } catch (err) {
    if (err instanceof SpendCapExceededError) {
      return { ok: false, tone: "error", error: err.message };
    }
    return {
      ok: false,
      tone: "error",
      error: err instanceof Error ? err.message : "Ingest failed.",
    };
  }
}
