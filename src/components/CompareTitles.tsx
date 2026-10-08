import type { CompareVideo } from "@/lib/bridge/compare";
import { translator, type Locale } from "@/lib/i18n";

/** My latest titles beside the competitors' best (build 2b, idea 4). */
export function CompareTitles({
  own,
  competitors,
  locale,
}: {
  own: CompareVideo[];
  competitors: CompareVideo[];
  locale: Locale;
}) {
  const t = translator(locale);
  const column = (heading: string, videos: CompareVideo[], showChannel: boolean) => (
    <div className="min-w-0">
      <h3 className="text-xs font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
        {heading}
      </h3>
      {videos.length === 0 ? (
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">{t("compare.titlesEmpty")}</p>
      ) : (
        <ol className="mt-2 flex flex-col gap-2 text-sm">
          {videos.map((video) => (
            <li key={video.videoId} className="text-[var(--color-ink)]">
              {video.title}
              <span className="block text-xs text-[var(--color-ink-muted)]">
                {showChannel ? `${video.sourceTitle} · ` : ""}
                {video.score === null ? "—" : t("compare.score", { score: video.score.toFixed(1) })}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
  return (
    <div className="mt-4 grid gap-6 sm:grid-cols-2">
      {column(t("compare.ownTitles"), own, false)}
      {column(t("compare.competitorTitles"), competitors, true)}
    </div>
  );
}
