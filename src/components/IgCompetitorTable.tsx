import type { SocialCompetitor } from "@/db/schema";
import { removeIgCompetitorAction } from "@/app/research/instagram/actions";
import { formatCompactNumber, formatDate } from "@/lib/format";
import type { Locale, Translator } from "@/lib/i18n";
import { NOT_AVAILABLE } from "@/lib/meta/discovery";

/** The tracked IG accounts of one brand (PLAN.md §6.S21); remove is the owner's. */
export function IgCompetitorTable({
  competitors,
  counts,
  canEdit,
  t,
  locale,
}: {
  competitors: SocialCompetitor[];
  counts: Map<number, number>;
  canEdit: boolean;
  t: Translator;
  locale: Locale;
}) {
  if (competitors.length === 0) {
    return <p className="mt-4 text-sm text-[var(--color-ink-muted)]">{t("ig.none")}</p>;
  }
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-[var(--color-ink-muted)]">
          <tr>
            <th className="py-2 pr-3 font-medium">{t("ig.col.account")}</th>
            <th className="py-2 pr-3 font-medium">{t("ig.col.followers")}</th>
            <th className="py-2 pr-3 font-medium">{t("ig.col.posts")}</th>
            <th className="py-2 pr-3 font-medium">{t("ig.col.synced")}</th>
            {canEdit ? <th className="py-2" /> : null}
          </tr>
        </thead>
        <tbody>
          {competitors.map((c) => (
            <tr key={c.id} className="border-t border-[var(--color-border)] align-top">
              <td className="py-2 pr-3">
                <a
                  href={`https://www.instagram.com/${c.handle}/`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-[var(--color-ink)] underline hover:text-[var(--color-accent)]"
                >
                  @{c.handle}
                </a>
                <span className="ml-2 text-xs text-[var(--color-ink-muted)]">
                  {t(c.role === "inspiration" ? "ig.role.inspiration" : "ig.role.competitor")}
                </span>
                {c.lastError === NOT_AVAILABLE ? (
                  <p
                    className="text-xs text-[var(--color-ink-muted)]"
                    title={t("ig.notAvailableHint")}
                  >
                    {t("ig.notAvailable")} — {t("ig.notAvailableHint")}
                  </p>
                ) : c.lastError ? (
                  <p className="text-xs text-[var(--color-danger,#b91c1c)]">{c.lastError}</p>
                ) : null}
              </td>
              <td className="py-2 pr-3">{formatCompactNumber(c.followers, locale)}</td>
              <td className="py-2 pr-3">{counts.get(c.id) ?? 0}</td>
              <td className="py-2 pr-3">
                {c.lastSyncedAt ? formatDate(c.lastSyncedAt, locale) : t("ig.never")}
              </td>
              {canEdit ? (
                <td className="py-2 text-right">
                  <form action={removeIgCompetitorAction}>
                    <input type="hidden" name="id" value={c.id} />
                    <button
                      type="submit"
                      className="text-xs underline text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
                    >
                      {t("ig.remove")}
                    </button>
                  </form>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
