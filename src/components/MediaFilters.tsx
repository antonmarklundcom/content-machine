import { ASSET_KINDS, ASSET_SOURCES, ASSET_STATUSES } from "@/db/schema";
import { translator, type Locale, type TranslationKey } from "@/lib/i18n";

const FIELD =
  "surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
const LABEL = "flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]";

export type MediaFilterValues = {
  brand: string;
  account: string;
  status: string;
  source: string;
  kind: string;
  tag: string;
  from: string;
  to: string;
};

/**
 * `/media` filters as a plain GET form, so every filtered view is a link
 * (PLAN.md §6.S14). The inbox view hides brand and account: everything there
 * is unsorted by definition.
 */
export function MediaFilters({
  locale,
  action,
  inbox,
  brands,
  accounts,
  tags,
  values,
}: {
  locale: Locale;
  action: string;
  inbox: boolean;
  brands: { id: string; name: string }[];
  accounts: { id: number; label: string }[];
  tags: { tag: string; count: number }[];
  values: MediaFilterValues;
}) {
  const t = translator(locale);
  const any = Object.values(values).some(Boolean);
  return (
    <form method="get" action={action} className="flex flex-wrap items-end gap-3">
      {!inbox && (
        <>
          <label className={LABEL}>
            {t("media.filter.brand")}
            <select name="brand" defaultValue={values.brand} className={FIELD}>
              <option value="">{t("media.filter.allBrands")}</option>
              <option value="none">{t("media.filter.unsorted")}</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            {t("media.filter.account")}
            <select name="account" defaultValue={values.account} className={FIELD}>
              <option value="">{t("media.filter.allAccounts")}</option>
              {accounts.map((a) => (
                <option key={a.id} value={String(a.id)}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      <label className={LABEL}>
        {t("media.filter.status")}
        <select name="status" defaultValue={values.status} className={FIELD}>
          <option value="">{t("media.filter.allStatuses")}</option>
          {ASSET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`media.status.${s}` as TranslationKey)}
            </option>
          ))}
        </select>
      </label>
      <label className={LABEL}>
        {t("media.filter.source")}
        <select name="source" defaultValue={values.source} className={FIELD}>
          <option value="">{t("media.filter.allSources")}</option>
          {ASSET_SOURCES.map((s) => (
            <option key={s} value={s}>
              {t(`media.source.${s}` as TranslationKey)}
            </option>
          ))}
        </select>
      </label>
      <label className={LABEL}>
        {t("media.filter.kind")}
        <select name="kind" defaultValue={values.kind} className={FIELD}>
          <option value="">{t("media.filter.allKinds")}</option>
          {ASSET_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`media.kind.${k}` as TranslationKey)}
            </option>
          ))}
        </select>
      </label>
      <label className={LABEL}>
        {t("media.filter.tag")}
        <select name="tag" defaultValue={values.tag} className={FIELD}>
          <option value="">{t("media.filter.allTags")}</option>
          {tags.map((tag) => (
            <option key={tag.tag} value={tag.tag}>
              {tag.tag} ({tag.count})
            </option>
          ))}
        </select>
      </label>
      <label className={LABEL}>
        {t("media.filter.from")}
        <input type="date" name="from" defaultValue={values.from} className={FIELD} />
      </label>
      <label className={LABEL}>
        {t("media.filter.to")}
        <input type="date" name="to" defaultValue={values.to} className={FIELD} />
      </label>
      <button
        type="submit"
        className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] hover:opacity-90"
      >
        {t("media.filter.apply")}
      </button>
      {any && (
        <a
          href={action}
          className="px-2 py-2 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          {t("media.filter.clear")}
        </a>
      )}
    </form>
  );
}
