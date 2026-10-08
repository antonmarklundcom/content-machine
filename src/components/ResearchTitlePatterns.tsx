import type { BrandOutlier } from "@/lib/bridge/research";
import { translator, type Locale } from "@/lib/i18n";
import { CopyTextButton } from "./CopyTextButton";

/** The outliers' titles side by side, copyable as one block (PLAN.md §6.S10.3). */
export function ResearchTitlePatterns({
  outliers,
  locale,
}: {
  outliers: BrandOutlier[];
  locale: Locale;
}) {
  const t = translator(locale);

  if (outliers.length === 0) {
    return (
      <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
        {t("research.titlePatternsEmpty")}
      </p>
    );
  }

  const text = outliers.map((v) => `${v.title} (${v.score.toFixed(1)}×)`).join("\n");
  return (
    <div className="mt-3 flex flex-col gap-3">
      <ul className="flex flex-col gap-1.5 text-sm text-[var(--color-ink)]">
        {outliers.map((v) => (
          <li key={v.videoId} className="flex gap-2">
            <span className="w-12 shrink-0 text-right tabular-nums text-[var(--color-ink-muted)]">
              {v.score.toFixed(1)}×
            </span>
            <span className="min-w-0">{v.title}</span>
          </li>
        ))}
      </ul>
      <div>
        <CopyTextButton text={text} label={t("research.copyTitles")} />
      </div>
    </div>
  );
}
