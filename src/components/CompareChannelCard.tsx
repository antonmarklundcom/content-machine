import type { CompareChannel } from "@/lib/bridge/compare";
import { formatCompactNumber } from "@/lib/format";
import { translator, type Locale } from "@/lib/i18n";

/** One channel's figures on the compare page (build 2b, idea 4). */
export function CompareChannelCard({
  channel,
  locale,
}: {
  channel: CompareChannel;
  locale: Locale;
}) {
  const t = translator(locale);
  const own = channel.role === "own";
  return (
    <li
      className={`surface-border surface-card p-5 ${own ? "outline-2 outline-[var(--color-accent)]" : ""}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <a
          href={channel.url}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-[var(--color-ink)] hover:text-[var(--color-accent)]"
        >
          {channel.title}
        </a>
        <span className="text-xs font-medium text-[var(--color-accent)]">
          {t(`research.role.${channel.role}`)}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-3 text-center">
        <div>
          <dt className="text-xs text-[var(--color-ink-muted)]">{t("compare.median")}</dt>
          <dd className="mt-1 text-lg font-semibold text-[var(--color-ink)]">
            {channel.medianViews === null ? (
              <span className="text-xs font-normal text-[var(--color-ink-muted)]">
                {t("compare.noMedian")}
              </span>
            ) : (
              formatCompactNumber(channel.medianViews, locale)
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-ink-muted)]">{t("compare.uploads")}</dt>
          <dd className="mt-1 text-lg font-semibold text-[var(--color-ink)]">
            {channel.uploadsPerMonth}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-ink-muted)]">{t("compare.videos")}</dt>
          <dd className="mt-1 text-lg font-semibold text-[var(--color-ink)]">
            {channel.videoCount}
          </dd>
        </div>
      </dl>
      <h3 className="mt-4 text-xs font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
        {t("compare.best")}
      </h3>
      {channel.best.length === 0 ? (
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">{t("compare.bestEmpty")}</p>
      ) : (
        <ol className="mt-2 flex flex-col gap-1.5 text-sm">
          {channel.best.map((video) => (
            <li key={video.videoId} className="flex items-baseline justify-between gap-3">
              <a
                href={`https://www.youtube.com/watch?v=${video.youtubeId}`}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 truncate text-[var(--color-ink)] hover:text-[var(--color-accent)]"
              >
                {video.title}
              </a>
              <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">
                {formatCompactNumber(video.viewCount, locale)} ·{" "}
                {t("compare.score", { score: (video.score ?? 0).toFixed(1) })}
              </span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}
