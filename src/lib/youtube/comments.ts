import { DEFAULT_DAILY_QUOTA, QuotaExhaustedError } from "./quota";

/**
 * YouTube comment threads (build 2b, idea 2): the top-level comments under a
 * video, most relevant first, for comment mining.
 *
 * `commentThreads.list` costs 1 unit per page, like every endpoint in
 * `data-api.ts`, and one page (≤ 100 threads) is all mining reads per video —
 * so ten videos cost ten units. The quota discipline is the same as
 * `YouTubeDataClient`'s: a per-run budget checked before each call, and a
 * `quotaExceeded` answer thrown as `QuotaExhaustedError`, never retried.
 * Its own small transport rather than a method on that client, because the
 * client's `call()` is private and its quota table is not this phase's to edit.
 */

const API_URL = "https://www.googleapis.com/youtube/v3/commentThreads";
export const COMMENT_THREADS_UNITS = 1;
export const COMMENT_PAGE_SIZE = 100;

export type VideoComment = {
  commentId: string;
  text: string;
  likeCount: number;
  replyCount: number;
  publishedAt: Date | null;
};

export type CommentsClientOptions = {
  apiKey?: string;
  /** Units this client may spend in one run; `YOUTUBE_QUOTA_BUDGET` or 10,000. */
  quotaBudget?: number;
  maxRetries?: number;
  timeoutMs?: number;
  /** Injected in tests; the global `fetch` otherwise. */
  fetch?: typeof fetch;
  /** Injected in tests so retries do not wait. */
  sleep?: (ms: number) => Promise<void>;
};

export class YouTubeCommentsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string | null,
  ) {
    super(message);
    this.name = "YouTubeCommentsError";
  }
}

/** Reasons that mean "this video has no comments to read", not "the call failed". */
const NO_COMMENTS_REASONS = new Set(["commentsDisabled", "videoNotFound", "forbidden"]);

export class YouTubeCommentsClient {
  private readonly apiKey: string;
  private readonly budget: number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private spent = 0;

  constructor(options: CommentsClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Missing YOUTUBE_API_KEY. Create an API key in Google Cloud Console " +
          "with the YouTube Data API v3 enabled. See .env.example.",
      );
    }
    this.apiKey = apiKey;
    const envBudget = Number(process.env.YOUTUBE_QUOTA_BUDGET);
    this.budget =
      options.quotaBudget ??
      (Number.isFinite(envBudget) && envBudget > 0 ? envBudget : DEFAULT_DAILY_QUOTA);
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get unitsSpent(): number {
    return this.spent;
  }

  /**
   * One page of a video's top-level comments, most relevant first, as plain
   * text. Comments disabled (or the video gone) → an empty list.
   */
  async topComments(youtubeId: string, maxResults = COMMENT_PAGE_SIZE): Promise<VideoComment[]> {
    if (this.spent + COMMENT_THREADS_UNITS > this.budget) {
      throw new QuotaExhaustedError(
        `Refusing commentThreads.list (${COMMENT_THREADS_UNITS} unit): this run has spent ${this.spent} of ` +
          `${this.budget} units. Raise YOUTUBE_QUOTA_BUDGET or wait for the daily reset ` +
          `(midnight America/Los_Angeles).`,
      );
    }
    this.spent += COMMENT_THREADS_UNITS;

    const url = new URL(API_URL);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("videoId", youtubeId);
    url.searchParams.set("order", "relevance");
    url.searchParams.set(
      "maxResults",
      String(Math.min(COMMENT_PAGE_SIZE, Math.max(1, maxResults))),
    );
    url.searchParams.set("textFormat", "plainText");
    url.searchParams.set("key", this.apiKey);

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await this.sleep(Math.min(8_000, 500 * 2 ** (attempt - 1)));

      let res: Response;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        res = await this.fetchImpl(url, { signal: controller.signal });
      } catch (err) {
        lastError = new YouTubeCommentsError(
          `commentThreads network error: ${err instanceof Error ? err.message : String(err)}`,
          0,
          "network",
        );
        continue;
      } finally {
        clearTimeout(timer);
      }

      if (res.ok) return parseCommentThreads(await res.json());

      const body = await res.text();
      const reason = extractReason(body);
      if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
        throw new QuotaExhaustedError(
          `YouTube Data API daily quota exhausted (${reason}). Resets at midnight America/Los_Angeles.`,
        );
      }
      if ((res.status === 403 || res.status === 404) && reason && NO_COMMENTS_REASONS.has(reason))
        return [];

      const retryable =
        res.status === 500 ||
        res.status === 503 ||
        res.status === 429 ||
        reason === "rateLimitExceeded";
      lastError = new YouTubeCommentsError(
        `commentThreads failed: HTTP ${res.status}${reason ? ` (${reason})` : ""} — ${body.slice(0, 300)}`,
        res.status,
        reason,
      );
      if (!retryable) throw lastError;
    }
    throw lastError ?? new YouTubeCommentsError("commentThreads failed after retries", 0, null);
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

export function parseCommentThreads(data: unknown): VideoComment[] {
  const items = asRecord(data)["items"];
  const out: VideoComment[] = [];
  for (const raw of Array.isArray(items) ? items : []) {
    const thread = asRecord(raw);
    const threadSnippet = asRecord(thread["snippet"]);
    const top = asRecord(threadSnippet["topLevelComment"]);
    const snippet = asRecord(top["snippet"]);
    const text =
      typeof snippet["textDisplay"] === "string" ? snippet["textDisplay"] : snippet["textOriginal"];
    if (typeof text !== "string" || !text.trim()) continue;
    const published =
      typeof snippet["publishedAt"] === "string" ? new Date(snippet["publishedAt"]) : null;
    out.push({
      commentId: String(top["id"] ?? thread["id"] ?? ""),
      text: text.trim(),
      likeCount: Number(snippet["likeCount"]) || 0,
      replyCount: Number(threadSnippet["totalReplyCount"]) || 0,
      publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
    });
  }
  return out;
}

/** `error.errors[0].reason` from a Data API error body, if it has one. */
function extractReason(body: string): string | null {
  try {
    const error = asRecord(asRecord(JSON.parse(body))["error"]);
    const first = asRecord((error["errors"] as unknown[] | undefined)?.[0]);
    return typeof first["reason"] === "string" ? first["reason"] : null;
  } catch {
    return null;
  }
}
