import type { BrandOutlier } from "@/lib/bridge/research";
import { formatCompactNumber, formatDate } from "@/lib/format";
import { translator, type Locale } from "@/lib/i18n";
import { ResearchAnalyzeButton } from "./ResearchAnalyzeButton";

const LINK =
  "surface-border rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] hover:border-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

/**
 * Top videos by outlier score (PLAN.md §6.S10.2). "Use as reference" hands the
 * video to a new script brief by query string only — S12 owns `/studio/new`.
 */
export function ResearchOutlierBoard({
  brandId,
  outliers,
  canAnalyse,
  locale,
}: {
  brandId: string;
  outliers: BrandOutlier[];
  canAnalyse: boolean;
  locale: Locale;
}) {
  const t = translator(locale);

  if (outliers.length === 0) {
    return (
      <p className="mt-4 text-sm text-[var(--color-ink-muted)]">{t("research.outliersEmpty")}</p>
    );
  }

  return (
    <ol className="mt-4 flex flex-col gap-3">
      {outliers.map((video) => {
        const reference = `/studio/new?${new URLSearchParams({ brand: brandId, ref: String(video.videoId) })}`;
        return (
          <li
            key={video.videoId}
            className="surface-border surface-card flex flex-col gap-3 p-4 sm:flex-row"
          >
            {video.thumbnailUrl && (
              // A remote YouTube thumbnail; next/image would need the host allow-listed.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={video.thumbnailUrl}
                alt=""
                loading="lazy"
                className="aspect-video w-full shrink-0 rounded-[var(--radius-sm)] object-cover sm:w-48"
              />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-medium leading-snug text-[var(--color-ink)]">{video.title}</h3>
                <span className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-2 py-0.5 text-xs font-semibold text-[var(--color-accent-ink)]">
                  {t("research.score", { score: video.score.toFixed(1) })}
                </span>
              </div>
              <p className="text-xs text-[var(--color-ink-muted)]">
                {video.sourceTitle} ·{" "}
                {t("research.views", { views: formatCompactNumber(video.viewCount, locale) })}
                {video.publishedAt ? ` · ${formatDate(video.publishedAt, locale)}` : ""}
              </p>
              <p className="text-sm text-[var(--color-ink-muted)] leading-relaxed">
                {video.analysisSummary ?? t("research.notAnalysed")}
              </p>
              <div className="flex flex-wrap items-start gap-2">
                {video.analysisId === null && canAnalyse && (
                  <ResearchAnalyzeButton videoId={video.videoId} locale={locale} />
                )}
                <a href={`/youtube/video/${video.videoId}`} className={LINK}>
                  {t("research.openDigest")}
                </a>
                <a href={reference} className={LINK}>
                  {t("research.useAsReference")}
                </a>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
