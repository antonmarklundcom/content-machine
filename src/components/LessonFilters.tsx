import { LESSON_KINDS } from "@/db/schema";
import { translator, type Locale, type TranslationKey } from "@/lib/i18n";

const FIELD =
  "surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

/** `/lessons` filters as a plain GET form, so every filtered view is a link (and the export reads the same params). */
export function LessonFilters({
  locale,
  brands,
  brand,
  kind,
  q,
}: {
  locale: Locale;
  brands: { id: string; name: string }[];
  brand: string;
  kind: string;
  q: string;
}) {
  const t = translator(locale);
  return (
    <form method="get" action="/lessons" className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
        {t("lessons.filter.brand")}
        <select name="brand" defaultValue={brand} className={FIELD}>
          <option value="">{t("lessons.filter.allBrands")}</option>
          <option value="none">{t("lessons.filter.noBrand")}</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
        {t("lessons.filter.kind")}
        <select name="kind" defaultValue={kind} className={FIELD}>
          <option value="">{t("lessons.filter.allKinds")}</option>
          {LESSON_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`lessons.kind.${k}` as TranslationKey)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
        {t("lessons.filter.search")}
        <input type="search" name="q" defaultValue={q} className={FIELD} />
      </label>
      <button
        type="submit"
        className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] hover:opacity-90"
      >
        {t("lessons.filter.apply")}
      </button>
      {(brand || kind || q) && (
        <a
          href="/lessons"
          className="px-2 py-2 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          {t("lessons.filter.clear")}
        </a>
      )}
    </form>
  );
}
