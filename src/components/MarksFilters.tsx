import { translator, type Locale, type TranslationKey } from "@/lib/i18n";
import { UNIT_TYPES, type UnitType } from "@/lib/listen/units";

const TYPE_LABEL: Record<UnitType, TranslationKey> = {
  summary: "section.summary",
  takeaway: "listen.unit.takeaway",
  hook: "section.hook",
  timeline: "listen.unit.timeline",
  gap: "listen.unit.gap",
  idea: "listen.unit.idea",
};

const FIELD =
  "surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

/**
 * [PR-37] The same plain GET form as DigestFilters (PR-21) — deliberately, not
 * incidentally. A second filter idiom would mean two places to fix the day the
 * search behaviour changes, and this page is the feed's sibling, not a new
 * kind of thing.
 */
export function MarksFilters({ q, type, locale }: { q: string; type: string; locale: Locale }) {
  const t = translator(locale);

  return (
    <form method="get" className="flex flex-wrap items-center gap-3">
      <label className="sr-only" htmlFor="marks-q">
        {t("marks.search")}
      </label>
      <input
        id="marks-q"
        type="search"
        name="q"
        defaultValue={q}
        placeholder={t("marks.search")}
        className={`${FIELD} w-72 placeholder:text-[var(--color-ink-muted)]`}
      />
      <label className="sr-only" htmlFor="marks-type">
        {t("marks.type.all")}
      </label>
      <select id="marks-type" name="type" defaultValue={type} className={FIELD}>
        <option value="">{t("marks.type.all")}</option>
        {UNIT_TYPES.map((unitType) => (
          <option key={unitType} value={unitType}>
            {t(TYPE_LABEL[unitType])}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      >
        {t("filters.submit")}
      </button>
    </form>
  );
}
