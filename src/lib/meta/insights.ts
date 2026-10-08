/**
 * Mapping Graph insights into `post_metrics` / `account_metrics` columns
 * (PLAN.md §2, §5.O12). Pure. Metrics differ per media type, so each type asks
 * for its own list; whatever Meta answers is also kept whole in `raw`.
 *
 * Graph v22+ retired `impressions` and `plays` for new media in favour of
 * `views`; `views` fills `plays` for reels and videos and `impressions` for
 * everything else, and an older response's own `impressions`/`plays` win.
 */

export type IgMedia = {
  id: string;
  caption?: string;
  media_type?: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | string;
  media_product_type?: "FEED" | "REELS" | "STORY" | "AD" | string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
};

export type MediaKind = "reel" | "carousel" | "image" | "video" | "story";

export function mediaKind(m: Pick<IgMedia, "media_type" | "media_product_type">): MediaKind {
  if (m.media_product_type === "REELS") return "reel";
  if (m.media_product_type === "STORY") return "story";
  if (m.media_type === "CAROUSEL_ALBUM") return "carousel";
  if (m.media_type === "VIDEO") return "video";
  return "image";
}

/** The metrics asked for per kind — only ones Meta supports for that kind. */
export const IG_MEDIA_METRICS: Record<MediaKind, string[]> = {
  image: ["reach", "views", "likes", "comments", "saved", "shares", "follows", "profile_visits"],
  video: ["reach", "views", "likes", "comments", "saved", "shares"],
  carousel: ["reach", "views", "likes", "comments", "saved", "shares"],
  reel: ["reach", "views", "likes", "comments", "saved", "shares", "ig_reels_avg_watch_time"],
  story: ["reach", "views", "shares", "follows", "profile_visits", "replies"],
};

type InsightValue = { value?: number | Record<string, number> };
export type InsightRow = {
  name: string;
  period?: string;
  values?: InsightValue[];
  total_value?: { value?: number };
};

/** One number per metric name: `total_value`, else the last `values` entry. */
export function insightNumbers(rows: InsightRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const v = r.total_value?.value ?? r.values?.[r.values.length - 1]?.value;
    if (typeof v === "number") out[r.name] = v;
  }
  return out;
}

export type PostMetricColumns = {
  reach: number | null;
  impressions: number | null;
  plays: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  follows: number | null;
  profileVisits: number | null;
};

const n = (v: number | undefined): number | null => (typeof v === "number" ? v : null);

export function mapIgMediaInsights(media: IgMedia, rows: InsightRow[]): PostMetricColumns {
  const m = insightNumbers(rows);
  const kind = mediaKind(media);
  const moving = kind === "reel" || kind === "video";
  return {
    reach: n(m.reach),
    impressions: n(m.impressions ?? (moving ? undefined : m.views)),
    plays: n(m.plays ?? (moving ? m.views : undefined)),
    likes: n(m.likes ?? media.like_count),
    comments: n(m.comments ?? media.comments_count),
    saves: n(m.saved),
    shares: n(m.shares),
    follows: n(m.follows),
    profileVisits: n(m.profile_visits),
  };
}

export type FbPost = {
  id: string;
  permalink_url?: string;
  created_time?: string;
  shares?: { count?: number };
  reactions?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
};

export function mapFbPostInsights(post: FbPost, rows: InsightRow[]): PostMetricColumns {
  const m = insightNumbers(rows);
  return {
    reach: n(m.post_impressions_unique),
    impressions: n(m.post_impressions),
    plays: n(m.post_video_views),
    likes: n(post.reactions?.summary?.total_count),
    comments: n(post.comments?.summary?.total_count),
    saves: null,
    shares: n(post.shares?.count ?? 0),
    follows: null,
    profileVisits: null,
  };
}

export type AccountMetricColumns = {
  followers: number | null;
  reach: number | null;
  profileVisits: number | null;
};

export function mapIgAccountInsights(
  followers: number | undefined,
  rows: InsightRow[],
): AccountMetricColumns {
  const m = insightNumbers(rows);
  return { followers: n(followers), reach: n(m.reach), profileVisits: n(m.profile_views) };
}

export function mapFbPageInsights(
  followers: number | undefined,
  rows: InsightRow[],
): AccountMetricColumns {
  const m = insightNumbers(rows);
  return { followers: n(followers), reach: n(m.page_impressions_unique), profileVisits: null };
}

/** Permalinks compared without scheme, `www.`, query or trailing slash (paths are case-sensitive). */
export function normalizePermalink(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}
