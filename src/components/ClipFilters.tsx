import { translator, type Locale, type TranslationKey } from "@/lib/i18n";
import {
  CLIP_PLATFORMS,
  CLIP_PURPOSES,
  CLIP_STATUSES,
  type ClipPlatform,
  type ClipPurpose,
  type ClipStatus,
} from "@/db/schema";

const STATUS_KEY: Record<ClipStatus, TranslationKey> = {
  unprocessed: "inbox.status.unprocessed",
  ingesting: "inbox.status.ingesting",
  analyzed: "inbox.status.analyzed",
  promoted: "inbox.status.promoted",
  failed: "inbox.status.failed",
};

const PLATFORM_KEY: Record<ClipPlatform, TranslationKey> = {
  youtube: "inbox.platform.youtube",
  instagram: "inbox.platform.instagram",
  facebook: "inbox.platform.facebook",
  other: "inbox.platform.other",
};

const PURPOSE_KEY: Record<ClipPurpose, TranslationKey> = {
  inspo: "capture.purpose.inspo",
  competitor: "capture.purpose.competitor",
  fact_check: "capture.purpose.fact_check",
  own: "capture.purpose.own",
  learn: "capture.purpose.learn",
  other: "capture.purpose.other",
};

export type ClipBrandOption = { id: string; name: string };

const FIELD =
  "surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

/** The same plain GET form idiom as MarksFilters/DigestFilters — see MarksFilters. */
export function ClipFilters({
  status,
  platform,
  brandId = "",
  purpose = "",
  tag = "",
  brands = [],
  locale,
}: {
  status: string;
  platform: string;
  /** [S16] Capture filters (PLAN.md §6.S16). */
  brandId?: string;
  purpose?: string;
  tag?: string;
  brands?: ClipBrandOption[];
  locale: Locale;
}) {
  const t = translator(locale);

  return (
    <form method="get" className="flex flex-wrap items-center gap-3">
      <label className="sr-only" htmlFor="clip-status">
        {t("inbox.filter.allStatuses")}
      </label>
      <select id="clip-status" name="status" defaultValue={status} className={FIELD}>
        <option value="">{t("inbox.filter.allStatuses")}</option>
        {CLIP_STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(STATUS_KEY[s])}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="clip-platform">
        {t("inbox.filter.allPlatforms")}
      </label>
      <select id="clip-platform" name="platform" defaultValue={platform} className={FIELD}>
        <option value="">{t("inbox.filter.allPlatforms")}</option>
        {CLIP_PLATFORMS.map((p) => (
          <option key={p} value={p}>
            {t(PLATFORM_KEY[p])}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="clip-brand">
        {t("capture.filter.allBrands")}
      </label>
      <select id="clip-brand" name="brand" defaultValue={brandId} className={FIELD}>
        <option value="">{t("capture.filter.allBrands")}</option>
        {brands.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="clip-purpose">
        {t("capture.filter.allPurposes")}
      </label>
      <select id="clip-purpose" name="purpose" defaultValue={purpose} className={FIELD}>
        <option value="">{t("capture.filter.allPurposes")}</option>
        {CLIP_PURPOSES.map((p) => (
          <option key={p} value={p}>
            {t(PURPOSE_KEY[p])}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="clip-tag">
        {t("capture.filter.tag")}
      </label>
      <input
        id="clip-tag"
        name="tag"
        defaultValue={tag}
        placeholder={`#${t("capture.filter.tagPlaceholder")}`}
        className={`${FIELD} w-32`}
      />
      <button
        type="submit"
        className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      >
        {t("filters.submit")}
      </button>
    </form>
  );
}

export { STATUS_KEY, PLATFORM_KEY, PURPOSE_KEY };
