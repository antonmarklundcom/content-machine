import type { BrandCompetitor } from "@/lib/bridge/research";
import { formatCompactNumber } from "@/lib/format";
import { translator, type Locale } from "@/lib/i18n";
import { removeCompetitor } from "@/lib/research.actions";
import { ConfirmSubmitButton } from "./ConfirmSubmitButton";
import { ResearchRoleToggle } from "./ResearchRoleToggle";

/** A brand's linked channels, with role toggle and remove (PLAN.md §6.S10.1). */
export function ResearchChannelList({
  brandId,
  channels,
  locale,
}: {
  brandId: string;
  channels: BrandCompetitor[];
  locale: Locale;
}) {
  const t = translator(locale);

  if (channels.length === 0) {
    return (
      <p className="mt-4 text-sm text-[var(--color-ink-muted)]">{t("research.channelsEmpty")}</p>
    );
  }

  return (
    <ul className="mt-4 flex flex-col gap-3">
      {channels.map((channel) => (
        <li
          key={channel.sourceId}
          className="surface-border surface-card flex flex-wrap items-center justify-between gap-3 p-4"
        >
          <div className="min-w-0">
            <a
              href={channel.url}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-[var(--color-ink)] hover:text-[var(--color-accent)]"
            >
              {channel.title}
            </a>
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
              {t("research.channelStats", {
                videos: channel.videoCount,
                analysed: channel.analyzedCount,
              })}{" "}
              ·{" "}
              {channel.medianViews === null
                ? t("research.noMedian")
                : t("research.median", { views: formatCompactNumber(channel.medianViews, locale) })}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ResearchRoleToggle
              brandId={brandId}
              sourceId={channel.sourceId}
              role={channel.role}
              locale={locale}
            />
            <form action={removeCompetitor.bind(null, brandId, channel.sourceId)}>
              <ConfirmSubmitButton
                message={t("research.removeConfirm")}
                className="surface-border rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium text-[var(--color-danger)] hover:border-[var(--color-danger)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
              >
                {t("research.remove")}
              </ConfirmSubmitButton>
            </form>
          </div>
        </li>
      ))}
    </ul>
  );
}
