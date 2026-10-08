import type { CaptionStatus } from "@/db/schema";
import { translator, type Locale, type TranslationKey } from "@/lib/i18n";
import type { DigestSort, ReadFilter } from "@/lib/videos";

const STATUS_OPTIONS: { value: CaptionStatus | ""; key: TranslationKey }[] = [
  { value: "", key: "filters.status.all" },
  { value: "available", key: "filters.status.available" },
  { value: "unknown", key: "filters.status.unknown" },
  { value: "none", key: "filters.status.none" },
  { value: "failed", key: "filters.status.failed" },
];

const FILTER_OPTIONS: { value: ReadFilter | ""; key: TranslationKey }[] = [
  { value: "", key: "filters.read.all" },
  { value: "unread", key: "filters.read.unread" },
  { value: "pinned", key: "filters.read.pinned" },
  { value: "marked", key: "filters.read.marked" },
];

const SORT_OPTIONS: { value: DigestSort; key: TranslationKey }[] = [
  { value: "published", key: "filters.sort.published" },
  { value: "added", key: "filters.sort.added" },
  { value: "views", key: "filters.sort.views" },
];

const FIELD =
  "surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

/**
 * Plain GET form — no client JS required, works with the URL as the only
 * state, and search engines never see it anyway (robots: noindex, PLAN.md §0).
 */
export function DigestFilters({
  q,
  status,
  filter,
  sort,
  locale,
}: {
  q: string;
  status: string;
  filter: string;
  sort: string;
  locale: Locale;
}) {
  const t = translator(locale);

  return (
    <form method="get" className="flex flex-wrap items-center gap-3">
      <label className="sr-only" htmlFor="digest-q">
        {t("filters.search")}
      </label>
      <input
        id="digest-q"
        type="search"
        name="q"
        defaultValue={q}
        placeholder={t("filters.search")}
        className={`${FIELD} w-72 placeholder:text-[var(--color-ink-muted)]`}
      />
      <label className="sr-only" htmlFor="digest-status">
        {t("filters.status.all")}
      </label>
      <select id="digest-status" name="status" defaultValue={status} className={FIELD}>
        {STATUS_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {t(opt.key)}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="digest-filter">
        {t("filters.read.all")}
      </label>
      <select id="digest-filter" name="filter" defaultValue={filter} className={FIELD}>
        {FILTER_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {t(opt.key)}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="digest-sort">
        {t("filters.sort.published")}
      </label>
      <select id="digest-sort" name="sort" defaultValue={sort} className={FIELD}>
        {SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {t(opt.key)}
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
