import type { Locale } from "@/lib/i18n";

/**
 * Formatting is locale-aware (PR-22). The hardcoded "en-US" here meant a
 * Swedish UI still rendered "Aug 20, 2026" and "1.2M" — the two places a
 * translated interface most visibly leaks its original language.
 *
 * The locale is passed in rather than read from a cookie: these are called from
 * client components too, and a formatter that quietly reaches for request state
 * cannot be.
 */
const INTL_LOCALE: Record<Locale, string> = { en: "en-US", sv: "sv-SE" };

function intl(locale: Locale | undefined): string {
  return INTL_LOCALE[locale ?? "en"];
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return "\u2014";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDate(value: Date | string | null, locale?: Locale): string {
  if (!value) return "\u2014";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString(intl(locale), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatCompactNumber(value: number | null, locale?: Locale): string {
  if (value === null) return "\u2014";
  return new Intl.NumberFormat(intl(locale), { notation: "compact" }).format(value);
}

/**
 * Likes per thousand views — the only engagement ratio YouTube still permits.
 *
 * [PR-33] Dislike counts were removed from the public API in 2021, so the
 * familiar like/dislike ratio cannot be computed by anyone, at any price. Likes
 * against views is the available substitute: it is noisier (it moves with how
 * much of the audience is logged in, and it drifts as a video ages) but it
 * separates a video people merely clicked from one they finished.
 *
 * Per *thousand* rather than a percentage because the real values cluster
 * between 1% and 6%, and "38" discriminates where "3.8%" reads as noise.
 *
 * Null when either counter is hidden or views are zero — a hidden like count is
 * not a zero like count, and dividing by an unwatched video is meaningless.
 */
export function likesPerThousandViews(
  likeCount: number | null,
  viewCount: number | null,
): number | null {
  if (likeCount === null || viewCount === null || viewCount <= 0) return null;
  return (likeCount / viewCount) * 1000;
}

export function formatLikeRate(
  likeCount: number | null,
  viewCount: number | null,
  locale?: Locale,
): string {
  const rate = likesPerThousandViews(likeCount, viewCount);
  if (rate === null) return "—";
  return new Intl.NumberFormat(intl(locale), {
    maximumFractionDigits: rate < 10 ? 1 : 0,
  }).format(rate);
}

/**
 * ASCII, lower-case, hyphenated, at most `max` characters — safe as a folder
 * or file name on Windows and in a URL. The media folder layout (PLAN.md
 * §1.41, `src/lib/storage/paths.ts`) builds its names with it. An input with
 * nothing sluggable in it gives `fallback`, never an empty name.
 */
export function slugify(text: string, options: { max?: number; fallback?: string } = {}): string {
  const { max = 60, fallback = "untitled" } = options;
  const slug = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug || fallback;
}
