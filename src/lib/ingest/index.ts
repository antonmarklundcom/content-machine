import type { Video } from "@/db/schema";
import { runHealth, type StrategyHealthSnapshot } from "@/lib/youtube/captions";
import { YouTubeDataClient } from "@/lib/youtube/data-api";
import { parseYouTubeUrl, type YouTubeRef } from "@/lib/youtube/url";
import {
  configuredDelayMs,
  fetchAndStoreCaptions,
  sleep,
  type CaptionOutcome,
  type CaptionPipelineOptions,
} from "./captions";
import { upsertChannelSource, upsertPlaylistSource, upsertVideoFromMetadata } from "./store";

export type IngestOptions = CaptionPipelineOptions & {
  /** Cap videos taken from a playlist or channel. */
  limit?: number;
  /** Store metadata only; run captions later via the backfill. */
  skipCaptions?: boolean;
  /**
   * Reuse a client — and therefore its QuotaTracker — across several calls.
   *
   * A caller that ingests many refs in one process (the poller, one call per
   * source) must pass one client for the whole run. Constructing a fresh one
   * per ref gives each its own tracker starting at zero, so the per-run guard
   * only ever sees a single source's usage and a runaway loop across 50
   * sources could burn the entire daily quota without ever tripping it.
   */
  client?: YouTubeDataClient;
  onProgress?: (event: IngestProgress) => void;
};

export type IngestProgress =
  | { phase: "resolved"; description: string }
  | { phase: "listed"; count: number }
  | { phase: "stored"; index: number; total: number; video: Video }
  | { phase: "captions"; index: number; total: number; video: Video; outcome: CaptionOutcome };

export type IngestSummary = {
  sourceId: number | null;
  videos: Video[];
  captionCounts: Record<CaptionOutcome["status"], number>;
  quota: string;
  /**
   * Per-strategy health for this process, as of the end of the call. Empty when
   * no captions were attempted. Reported rather than logged so the CLI, the
   * poller and the cron route can each say what they need to.
   */
  captionHealth: StrategyHealthSnapshot[];
};

/**
 * Ingest any YouTube URL: video, playlist, channel or @handle.
 *
 * Metadata for every video is stored before any captions are fetched. Captions
 * are the slow, rate-limited, failure-prone half — if a run dies partway, the
 * corpus still knows the videos exist and the backfill picks up exactly where
 * it stopped, rather than losing the whole listing.
 */
export async function ingestUrl(
  input: string,
  options: IngestOptions = {},
): Promise<IngestSummary> {
  const ref = parseYouTubeUrl(input);
  if (!ref) throw new Error(`Not a recognisable YouTube URL or ID: ${input}`);
  return ingestRef(ref, options);
}

export async function ingestRef(
  ref: YouTubeRef,
  options: IngestOptions = {},
): Promise<IngestSummary> {
  const client = options.client ?? new YouTubeDataClient();
  const report = options.onProgress ?? (() => {});

  const resolved = await client.resolve(ref);
  if (!resolved)
    throw new Error("YouTube returned no such entity (deleted, private, or wrong id).");

  let sourceId: number | null = null;
  let videoIds: string[];

  switch (resolved.kind) {
    case "video":
      report({ phase: "resolved", description: `video "${resolved.video.title}"` });
      videoIds = [resolved.video.youtubeId];
      break;

    case "channel": {
      const source = await upsertChannelSource(resolved.channel);
      sourceId = source.id;
      report({ phase: "resolved", description: `channel "${resolved.channel.title}"` });
      const uploads = await client.listChannelUploads(resolved.channel.channelId, {
        limit: options.limit,
      });
      videoIds = uploads.videoIds;
      break;
    }

    case "playlist": {
      const source = await upsertPlaylistSource(resolved.playlist);
      sourceId = source.id;
      report({ phase: "resolved", description: `playlist "${resolved.playlist.title}"` });
      videoIds = await client.listPlaylistVideoIds(resolved.playlist.playlistId, {
        limit: options.limit,
      });
      break;
    }
  }

  report({ phase: "listed", count: videoIds.length });

  // One batched metadata call per 50 ids, then all rows written up front.
  const metadata = await client.getVideos(videoIds);
  const stored: Video[] = [];
  for (const [index, meta] of metadata.entries()) {
    const video = await upsertVideoFromMetadata(meta, sourceId);
    stored.push(video);
    report({ phase: "stored", index, total: metadata.length, video });
  }

  const captionCounts: Record<CaptionOutcome["status"], number> = {
    available: 0,
    none: 0,
    failed: 0,
    skipped: 0,
  };

  if (!options.skipCaptions) {
    const delay = configuredDelayMs();
    for (const [index, video] of stored.entries()) {
      const outcome = await fetchAndStoreCaptions(video, options);
      captionCounts[outcome.status] += 1;
      report({ phase: "captions", index, total: stored.length, video, outcome });
      // Pace the run. A skip did no network work, so it does not need pacing.
      if (outcome.status !== "skipped" && index < stored.length - 1) await sleep(delay);
    }
  }

  return {
    sourceId,
    videos: stored,
    captionCounts,
    quota: client.quota.summary(),
    captionHealth: options.skipCaptions ? [] : runHealth().snapshot(),
  };
}

export * from "./captions";
export * from "./store";
