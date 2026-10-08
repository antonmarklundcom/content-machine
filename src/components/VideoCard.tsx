import Link from "next/link";
import { analysisState } from "@/lib/analysis/state";
import { translator, type Locale } from "@/lib/i18n";
import type { DigestVideo } from "@/lib/videos";
import {
  formatCompactNumber,
  formatLikeRate,
  likesPerThousandViews,
  formatDate,
  formatDuration,
} from "@/lib/format";
import { AnalysisBadge } from "./AnalysisBadge";
import { CaptionBadge } from "./CaptionBadge";
import { ScreenBadge } from "./ScreenBadge";

export function VideoCard({ video, locale }: { video: DigestVideo; locale: Locale }) {
  const t = translator(locale);
  // Read videos recede rather than disappear: the corpus is the point, but an
  // unread item has to be findable in a grid of 24 without reading titles.
  const unread = video.readAt === null;

  return (
    <Link
      href={`/youtube/video/${video.id}`}
      className={`surface-border surface-card group flex flex-col overflow-hidden transition-transform duration-200 hover:-translate-y-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${
        unread ? "" : "opacity-70 hover:opacity-100"
      }`}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-[var(--color-surface)]">
        {video.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- external YouTube-hosted thumbnails, not worth Next's image optimizer for a private tool
          <img
            src={video.thumbnailUrl}
            alt=""
            // A page of 24 cards is 24 external requests to i.ytimg.com;
            // only the ones in view are worth paying for.
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-[var(--color-ink-muted)]">
            {t("card.noThumbnail")}
          </div>
        )}
        <span className="absolute right-2 bottom-2 rounded-[var(--radius-sm)] bg-black/75 px-1.5 py-0.5 text-xs text-white">
          {formatDuration(video.durationSeconds)}
        </span>
        {video.pinned && (
          <span className="absolute top-2 left-2 rounded-[var(--radius-sm)] bg-black/75 px-1.5 py-0.5 text-xs text-white">
            {`\u2605 ${t("card.pinned")}`}
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-2 flex gap-2 text-sm font-medium text-balance text-[var(--color-ink)]">
          {unread && (
            <span
              aria-label={t("card.unread")}
              className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--color-accent)]"
            />
          )}
          <span>{video.title}</span>
        </h3>
        <p className="text-xs text-[var(--color-ink-muted)]">
          {video.channelTitle ?? t("video.unknownChannel")}
        </p>
        {/* Why this card is in the results (PR-30). A hit inside an analysis
            used to look identical to a title match, which made the reason for
            half the results invisible. */}
        {video.match?.field === "analysis" && (
          <p className="border-l-2 border-[var(--color-accent)] pl-2 text-xs text-[var(--color-ink-muted)] italic">
            {video.match.excerpt ?? t("card.matchedAnalysis")}
          </p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          <CaptionBadge status={video.captionStatus} locale={locale} />
          <AnalysisBadge
            state={analysisState(video.analysisStatus, video.captionStatus)}
            locale={locale}
          />
          {/* [PR-35] Sits after the analysis badge on purpose: "pending
              analysis · culled" reads as the sentence it is — queued, then
              taken out of the queue and why. */}
          <ScreenBadge score={video.screenScore} reason={video.screenReason} locale={locale} />
          <span className="ml-auto text-xs text-[var(--color-ink-muted)]">
            {formatDate(video.publishedAt, locale)} · {formatCompactNumber(video.viewCount, locale)}{" "}
            {t("card.views")}
            {/* [PR-33] Engagement, not just reach. Rendered only when the
                uploader publishes both counters — a hidden like count is not a
                zero one, so the absent case shows nothing rather than "0". */}
            {likesPerThousandViews(video.likeCount, video.viewCount) !== null && (
              <>
                {" · "}
                {formatLikeRate(video.likeCount, video.viewCount, locale)} {t("card.likeRate")}
              </>
            )}
          </span>
        </div>
      </div>
    </Link>
  );
}
