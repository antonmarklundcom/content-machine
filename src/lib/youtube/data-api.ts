import { QuotaExhaustedError, QuotaTracker, type QuotaOperation } from "./quota";
import type { YouTubeRef } from "./url";

/**
 * YouTube Data API v3 client.
 *
 * Deliberately does not expose search.list — see src/lib/youtube/quota.ts for
 * why that single omission is what keeps the project inside the free quota.
 */

const API_BASE = "https://www.googleapis.com/youtube/v3";

/** The API caps id batches and page sizes at 50 for every endpoint we use. */
const MAX_BATCH = 50;

export type VideoMetadata = {
  youtubeId: string;
  title: string;
  /**
   * The uploader's description. Already present in the `snippet` part every
   * videos.list call requests, so it costs no extra quota — it was simply
   * discarded before PR-33. The metadata screening (PR-35) reads it instead of
   * the transcript, which is the whole reason that pass is nearly free.
   */
  description: string | null;
  channelId: string;
  channelTitle: string;
  publishedAt: Date | null;
  durationSeconds: number | null;
  viewCount: number | null;
  /**
   * Absent when the uploader hides likes. Dislikes have not been public since
   * 2021, so the only ratio available is likes-per-view — see
   * `likesPerThousandViews` in src/lib/format.ts.
   */
  likeCount: number | null;
  commentCount: number | null;
  thumbnailUrl: string | null;
  /** True for scheduled/live streams, which have no stable duration yet. */
  isLive: boolean;
};

export type ChannelMetadata = {
  channelId: string;
  title: string;
  handle: string | null;
  /** The playlist holding every public upload — the cheap route to a channel's videos. */
  uploadsPlaylistId: string | null;
  thumbnailUrl: string | null;
};

export type PlaylistMetadata = {
  playlistId: string;
  title: string;
  channelTitle: string | null;
  itemCount: number | null;
};

export type PlaylistPage = {
  videoIds: string[];
  nextPageToken: string | null;
};

export class YouTubeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string | null,
  ) {
    super(message);
    this.name = "YouTubeApiError";
  }
}

export type DataApiOptions = {
  apiKey?: string;
  quotaBudget?: number;
  maxRetries?: number;
  timeoutMs?: number;
};

export class YouTubeDataClient {
  readonly quota: QuotaTracker;
  private readonly apiKey: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(options: DataApiOptions = {}) {
    const apiKey = options.apiKey ?? process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Missing YOUTUBE_API_KEY. Create an API key in Google Cloud Console " +
          "with the YouTube Data API v3 enabled. See .env.example.",
      );
    }
    this.apiKey = apiKey;
    const envBudget = Number(process.env.YOUTUBE_QUOTA_BUDGET);
    this.quota = new QuotaTracker(
      options.quotaBudget ?? (Number.isFinite(envBudget) && envBudget > 0 ? envBudget : undefined),
    );
    this.maxRetries = options.maxRetries ?? 4;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  // -------------------------------------------------------------------------
  // videos
  // -------------------------------------------------------------------------

  /**
   * Fetch metadata for up to any number of ids, batched 50 per call — so 200
   * videos costs 4 units, not 200.
   */
  async getVideos(videoIds: string[]): Promise<VideoMetadata[]> {
    const unique = [...new Set(videoIds.filter(Boolean))];
    const out: VideoMetadata[] = [];

    for (let i = 0; i < unique.length; i += MAX_BATCH) {
      const batch = unique.slice(i, i + MAX_BATCH);
      const data = await this.call("videos.list", "videos", {
        part: "snippet,contentDetails,statistics,liveStreamingDetails",
        id: batch.join(","),
        maxResults: String(MAX_BATCH),
      });
      for (const item of asArray(data["items"])) out.push(parseVideo(item));
    }
    return out;
  }

  async getVideo(videoId: string): Promise<VideoMetadata | null> {
    const [video] = await this.getVideos([videoId]);
    return video ?? null;
  }

  // -------------------------------------------------------------------------
  // channels
  // -------------------------------------------------------------------------

  async getChannelById(channelId: string): Promise<ChannelMetadata | null> {
    const data = await this.call("channels.list", "channels", {
      part: "snippet,contentDetails",
      id: channelId,
    });
    const item = asArray(data["items"])[0];
    return item ? parseChannel(item) : null;
  }

  /**
   * Resolve an @handle, /c/Name or /user/Name to a channel.
   *
   * Tries forHandle, then forUsername (legacy vanity URLs). Both cost 1 unit;
   * search.list would cost 100 for the same answer, which is exactly the trap
   * this client exists to avoid.
   */
  async getChannelByHandle(handle: string): Promise<ChannelMetadata | null> {
    const clean = handle.replace(/^@/, "");
    for (const param of ["forHandle", "forUsername"] as const) {
      const data = await this.call("channels.list", "channels", {
        part: "snippet,contentDetails",
        [param]: param === "forHandle" ? `@${clean}` : clean,
      });
      const item = asArray(data["items"])[0];
      if (item) return parseChannel(item);
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // playlists
  // -------------------------------------------------------------------------

  async getPlaylist(playlistId: string): Promise<PlaylistMetadata | null> {
    const data = await this.call("playlists.list", "playlists", {
      part: "snippet,contentDetails",
      id: playlistId,
    });
    const raw = asArray(data["items"])[0];
    if (!raw) return null;
    const item = asRecord(raw);
    const snippet = asRecord(item["snippet"]);
    const details = asRecord(item["contentDetails"]);
    return {
      playlistId: String(item["id"] ?? playlistId),
      title: String(snippet["title"] ?? "Untitled playlist"),
      channelTitle: snippet["channelTitle"] ? String(snippet["channelTitle"]) : null,
      itemCount: typeof details["itemCount"] === "number" ? details["itemCount"] : null,
    };
  }

  /** One page of a playlist (≤50 video ids) for 1 unit. */
  async listPlaylistPage(playlistId: string, pageToken?: string): Promise<PlaylistPage> {
    const data = await this.call("playlistItems.list", "playlistItems", {
      part: "contentDetails",
      playlistId,
      maxResults: String(MAX_BATCH),
      ...(pageToken ? { pageToken } : {}),
    });

    const videoIds: string[] = [];
    for (const item of asArray(data["items"])) {
      const id = asRecord(asRecord(item)["contentDetails"])["videoId"];
      // Deleted and private entries stay in the playlist with no videoId.
      if (typeof id === "string" && id) videoIds.push(id);
    }

    return {
      videoIds,
      nextPageToken: typeof data["nextPageToken"] === "string" ? data["nextPageToken"] : null,
    };
  }

  /**
   * Walk a playlist, newest first.
   *
   * `limit` exists because the uploads playlist of a long-running channel can be
   * thousands of videos, and the hourly poller only needs the newest few — paging
   * to the end every hour would waste quota on videos already stored.
   */
  async listPlaylistVideoIds(
    playlistId: string,
    options: { limit?: number } = {},
  ): Promise<string[]> {
    const limit = options.limit ?? Infinity;
    const ids: string[] = [];
    let pageToken: string | undefined;

    do {
      const page = await this.listPlaylistPage(playlistId, pageToken);
      for (const id of page.videoIds) {
        ids.push(id);
        if (ids.length >= limit) return ids;
      }
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken);

    return ids;
  }

  /** A channel's uploads, via its uploads playlist — 2 units, not 100. */
  async listChannelUploads(
    channelId: string,
    options: { limit?: number } = {},
  ): Promise<{ channel: ChannelMetadata; videoIds: string[] }> {
    const channel = await this.getChannelById(channelId);
    if (!channel) throw new YouTubeApiError(`Channel ${channelId} not found`, 404, "notFound");
    if (!channel.uploadsPlaylistId) {
      throw new YouTubeApiError(
        `Channel ${channelId} exposes no uploads playlist`,
        404,
        "noUploadsPlaylist",
      );
    }
    const videoIds = await this.listPlaylistVideoIds(channel.uploadsPlaylistId, options);
    return { channel, videoIds };
  }

  // -------------------------------------------------------------------------
  // resolution
  // -------------------------------------------------------------------------

  /**
   * Turn a parsed URL into a concrete entity. Collapses the handle case so
   * callers only ever deal with video | playlist | channel.
   */
  async resolve(ref: YouTubeRef): Promise<ResolvedRef | null> {
    switch (ref.kind) {
      case "video": {
        const video = await this.getVideo(ref.videoId);
        return video ? { kind: "video", video } : null;
      }
      case "playlist": {
        const playlist = await this.getPlaylist(ref.playlistId);
        return playlist ? { kind: "playlist", playlist } : null;
      }
      case "channel": {
        const channel = await this.getChannelById(ref.channelId);
        return channel ? { kind: "channel", channel } : null;
      }
      case "channel_handle": {
        const channel = await this.getChannelByHandle(ref.handle);
        return channel ? { kind: "channel", channel } : null;
      }
    }
  }

  // -------------------------------------------------------------------------
  // transport
  // -------------------------------------------------------------------------

  private async call(
    op: QuotaOperation,
    path: string,
    params: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    this.quota.charge(op);

    const url = new URL(`${API_BASE}/${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("key", this.apiKey);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await sleep(backoffMs(attempt));

      let res: Response;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        res = await fetch(url, { signal: controller.signal });
      } catch (err) {
        lastError = new YouTubeApiError(
          controller.signal.aborted
            ? `${path} timed out after ${this.timeoutMs}ms`
            : `${path} network error: ${err instanceof Error ? err.message : String(err)}`,
          0,
          "network",
        );
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (res.ok) return (await res.json()) as Record<string, unknown>;

      const body = await res.text();
      const reason = extractReason(body);

      // quotaExceeded is a daily budget, not a rate limit — retrying cannot help
      // and only makes the next legitimate call fail sooner.
      if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
        throw new QuotaExhaustedError(
          `YouTube Data API daily quota exhausted (${reason}). Resets at midnight ` +
            `America/Los_Angeles. Spent this run: ${this.quota.summary()}.`,
        );
      }

      // These are genuinely transient; everything else is a bug in the request.
      const retryable =
        res.status === 500 ||
        res.status === 503 ||
        res.status === 429 ||
        reason === "rateLimitExceeded" ||
        reason === "backendError";

      lastError = new YouTubeApiError(
        `${path} failed: HTTP ${res.status}${reason ? ` (${reason})` : ""} — ${truncate(body, 300)}`,
        res.status,
        reason,
      );

      if (!retryable) throw lastError;
    }

    throw lastError ?? new YouTubeApiError(`${path} failed after retries`, 0, null);
  }
}

export type ResolvedRef =
  | { kind: "video"; video: VideoMetadata }
  | { kind: "playlist"; playlist: PlaylistMetadata }
  | { kind: "channel"; channel: ChannelMetadata };

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

function parseVideo(raw: unknown): VideoMetadata {
  const item = asRecord(raw);
  const snippet = asRecord(item["snippet"]);
  const details = asRecord(item["contentDetails"]);
  const stats = asRecord(item["statistics"]);
  const live = asRecord(item["liveStreamingDetails"]);

  const publishedRaw = snippet["publishedAt"];
  const published = typeof publishedRaw === "string" ? new Date(publishedRaw) : null;

  return {
    youtubeId: String(item["id"] ?? ""),
    title: String(snippet["title"] ?? "Untitled"),
    description: typeof snippet["description"] === "string" ? snippet["description"] : null,
    channelId: String(snippet["channelId"] ?? ""),
    channelTitle: String(snippet["channelTitle"] ?? ""),
    publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
    durationSeconds: parseIso8601Duration(
      typeof details["duration"] === "string" ? details["duration"] : null,
    ),
    // Counts arrive as strings, and are absent when the owner hides them.
    viewCount: countFrom(stats["viewCount"]),
    likeCount: countFrom(stats["likeCount"]),
    commentCount: countFrom(stats["commentCount"]),
    thumbnailUrl: bestThumbnail(snippet["thumbnails"]),
    isLive: Object.keys(live).length > 0 && !live["actualEndTime"],
  };
}

/**
 * A statistics counter, or null when YouTube omits it.
 *
 * Absent and zero are different facts: a video with likes hidden is not a video
 * with no likes, and averaging the two together would quietly understate every
 * channel that hides one counter. Null survives to the column so the UI can say
 * "hidden" rather than "0".
 */
function countFrom(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseChannel(raw: unknown): ChannelMetadata {
  const item = asRecord(raw);
  const snippet = asRecord(item["snippet"]);
  const uploads = asRecord(asRecord(item["contentDetails"])["relatedPlaylists"]);

  const customUrl = snippet["customUrl"];
  return {
    channelId: String(item["id"] ?? ""),
    title: String(snippet["title"] ?? "Untitled channel"),
    handle: typeof customUrl === "string" ? customUrl.replace(/^@/, "") : null,
    uploadsPlaylistId: typeof uploads["uploads"] === "string" ? uploads["uploads"] : null,
    thumbnailUrl: bestThumbnail(snippet["thumbnails"]),
  };
}

/**
 * Largest available thumbnail. YouTube omits the bigger sizes on older videos,
 * so this walks down rather than assuming a key exists.
 */
function bestThumbnail(raw: unknown): string | null {
  const thumbs = asRecord(raw);
  for (const size of ["maxres", "standard", "high", "medium", "default"]) {
    const url = asRecord(thumbs[size])["url"];
    if (typeof url === "string" && url) return url;
  }
  return null;
}

const ISO_DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/**
 * contentDetails.duration is ISO-8601 ("PT14M32S"). Live streams report "P0D",
 * which correctly parses to 0 and is why callers check isLive rather than
 * treating 0 as missing data.
 */
export function parseIso8601Duration(input: string | null): number | null {
  if (!input) return null;
  const m = ISO_DURATION.exec(input);
  if (!m) return null;
  const [, d, h, min, s] = m;
  return (
    Number(d ?? 0) * 86400 +
    Number(h ?? 0) * 3600 +
    Number(min ?? 0) * 60 +
    Math.round(Number(s ?? 0))
  );
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function extractReason(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const error = asRecord(parsed["error"]);
    const first = asArray(error["errors"])[0];
    const reason = asRecord(first)["reason"];
    return typeof reason === "string" ? reason : null;
  } catch {
    return null;
  }
}

/** Exponential backoff with jitter, so parallel workers do not resynchronise. */
function backoffMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** (attempt - 1), 16_000);
  return base + Math.random() * 250;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
