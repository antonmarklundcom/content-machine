import { upsertReturning } from "@/db/mutations";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { transcripts, videos, type Video } from "@/db/schema";
import { fetchCaptions, type StrategyName } from "@/lib/youtube/captions";

/**
 * The caption pipeline (PLAN.md §5 row 05): probe -> fetch -> store transcript
 * -> set caption_status.
 *
 * This is the one place where PR-01's outcome becomes load-bearing. The
 * strategies are pluggable and ordered by env (CAPTION_STRATEGIES), so whichever
 * strategy the host proves out is configuration, not a code change. On top of
 * that list, fetchCaptions retires strategies that keep failing within a run
 * (src/lib/youtube/captions/health.ts), so a host where nothing works stops
 * paying six timeouts per video after the first few videos have said so.
 */

export type CaptionOutcome =
  | { status: "available"; wordCount: number; strategy: StrategyName; language: string }
  | { status: "none" }
  | { status: "failed"; error: string }
  | { status: "skipped"; why: "already-have-transcript" | "known-no-captions" };

export type CaptionPipelineOptions = {
  /** Re-fetch even when a transcript already exists. */
  force?: boolean;
  /**
   * Retry videos previously marked 'none'. Off by default — 'none' is a property
   * of the video, so retrying it burns requests and makes us look like a scraper
   * for an answer that will not change.
   */
  retryNone?: boolean;
};

/** Ordered strategy list, pinned by env once PR-01 has reported from Hostinger. */
export function configuredStrategies(): StrategyName[] | undefined {
  const raw = process.env.CAPTION_STRATEGIES;
  if (!raw) return undefined;
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as StrategyName[];
  return list.length > 0 ? list : undefined;
}

export function configuredLanguages(): string[] {
  const raw = process.env.CAPTION_LANGUAGES;
  if (!raw) return ["en"];
  const list = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : ["en"];
}

/**
 * Delay between videos in a batch.
 *
 * Hammering YouTube from a datacenter IP is the fastest way to turn a working
 * PR-01 into a blocked one, and a poll run has nobody waiting on it. Default
 * 1.5s; set CAPTION_DELAY_MS=0 for a single interactive fetch.
 */
export function configuredDelayMs(): number {
  const raw = Number(process.env.CAPTION_DELAY_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 1_500;
}

export async function fetchAndStoreCaptions(
  video: Video,
  options: CaptionPipelineOptions = {},
): Promise<CaptionOutcome> {
  if (!options.force) {
    if (video.captionStatus === "none" && !options.retryNone) {
      return { status: "skipped", why: "known-no-captions" };
    }
    if (video.captionStatus === "available") {
      const [existing] = await db
        .select({ id: transcripts.id })
        .from(transcripts)
        .where(eq(transcripts.videoId, video.id))
        .limit(1);
      // Trust the row, not the status column: a crash between writing the
      // transcript and updating the status would otherwise strand the video.
      if (existing) return { status: "skipped", why: "already-have-transcript" };
    }
  }

  const result = await fetchCaptions(video.youtubeId, {
    preferredLanguages: configuredLanguages(),
    strategies: configuredStrategies(),
  });

  if (result.ok) {
    const { text, wordCount, languageCode, strategy } = result.result;

    // Order matters: write the transcript first, then flip the status. The
    // reverse would mark a video 'available' with no transcript behind it if the
    // process died in between, and the skip path above would never retry it.
    await upsertReturning(
      db,
      transcripts,
      {
        videoId: video.id,
        language: languageCode,
        source: "captions",
        wordCount,
        content: text,
      },
      {
        target: transcripts.videoId,
        set: { language: languageCode, source: "captions", wordCount, content: text },
      },
    );

    await setStatus(video.id, "available");
    return { status: "available", wordCount, strategy, language: languageCode };
  }

  if (result.reason === "no_captions") {
    // Terminal for this video. PLAN.md §0: videos without captions are marked
    // unavailable and skipped — audio transcription is not a v1 fallback.
    await setStatus(video.id, "none");
    return { status: "none" };
  }

  const attempted = result.attempts
    .filter((a) => !a.ok)
    .map((a) => `${a.strategy}=${a.ok ? "" : a.reason}`)
    .join(" ");
  // Name the strategies that were not tried at all. Without this a run where
  // health tracking has retired everything reports an empty reason list, which
  // reads like a bug rather than the deliberate saving it is.
  const detail = result.skipped.length
    ? `${attempted}${attempted ? " " : ""}(retired: ${result.skipped.join(",")})`
    : attempted;
  await setStatus(video.id, "failed");
  return { status: "failed", error: `${result.reason}: ${detail}` };
}

async function setStatus(videoId: number, status: "available" | "none" | "failed"): Promise<void> {
  await db
    .update(videos)
    .set({ captionStatus: status, captionCheckedAt: new Date() })
    .where(eq(videos.id, videoId));
}

export function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
}
