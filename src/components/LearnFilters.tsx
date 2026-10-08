import { LEARN_CATEGORIES } from "@/lib/learn/categories";
import { learnSearchString, type LearnQuery } from "@/lib/learn/query";
import { translator, type Locale, type TranslationKey } from "@/lib/i18n";

const FIELD =
  "surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

const BADGE =
  "surface-border inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-xs";

/**
 * `/learn` filters as a plain GET form (every filtered view is a link), plus
 * one badge per category with its count under the other filters.
 */
export function LearnFilters({
  locale,
  query,
  counts,
}: {
  locale: Locale;
  query: Omit<LearnQuery, "page">;
  counts: Record<string, number>;
}) {
  const t = translator(locale);
  const all = Object.values(counts).reduce((a, b) => a + b, 0);
  const badges: { key: string; label: string; count: number }[] = [
    ...LEARN_CATEGORIES.map((c) => ({
      key: c,
      label: t(`learn.category.${c}` as TranslationKey),
      count: counts[c] ?? 0,
    })),
    { key: "none", label: t("learn.category.none"), count: counts.none ?? 0 },
  ].filter((b) => b.count > 0 || b.key === query.category);
  const active = (key: string | undefined) =>
    key === query.category
      ? "border-[var(--color-accent)] text-[var(--color-accent)]"
      : "text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]";

  return (
    <div className="flex flex-col gap-3">
      <nav className="flex flex-wrap gap-2" aria-label={t("learn.filter.category")}>
        <a
          href={`/learn${learnSearchString(query, { category: undefined })}`}
          className={`${BADGE} ${active(undefined)}`}
        >
          {t("learn.badge.all")} <span className="opacity-70">{all}</span>
        </a>
        {badges.map((b) => (
          <a
            key={b.key}
            href={`/learn${learnSearchString(query, { category: b.key })}`}
            className={`${BADGE} ${active(b.key)}`}
          >
            {b.label} <span className="opacity-70">{b.count}</span>
          </a>
        ))}
      </nav>

      <form method="get" action="/learn" className="flex flex-wrap items-end gap-3">
        {query.category && <input type="hidden" name="category" value={query.category} />}
        <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
          {t("learn.filter.implemented")}
          <select name="implemented" defaultValue={query.implemented ?? ""} className={FIELD}>
            <option value="">{t("learn.filter.any")}</option>
            <option value="yes">{t("learn.filter.yes")}</option>
            <option value="no">{t("learn.filter.no")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
          {t("learn.filter.committed")}
          <select name="committed" defaultValue={query.committed ?? ""} className={FIELD}>
            <option value="">{t("learn.filter.any")}</option>
            <option value="yes">{t("learn.filter.yes")}</option>
            <option value="no">{t("learn.filter.no")}</option>
          </select>
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
          {t("learn.filter.search")}
          <input type="search" name="q" defaultValue={query.search ?? ""} className={FIELD} />
        </label>
        <button
          type="submit"
          className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] hover:opacity-90"
        >
          {t("learn.filter.apply")}
        </button>
        {(query.category || query.implemented || query.committed || query.search) && (
          <a
            href="/learn"
            className="px-2 py-2 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          >
            {t("learn.filter.clear")}
          </a>
        )}
      </form>
    </div>
  );
}
