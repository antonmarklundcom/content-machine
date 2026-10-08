import { translator, type Locale } from "@/lib/i18n";

/**
 * Exported for the test alone. The bug this component shipped with (PR-09
 * through PR-37: every listing's page links pointed at the feed) lived entirely
 * in this function, so it is the part worth pinning down.
 */
export function buildHref(basePath: string, params: URLSearchParams, page: number): string {
  const next = new URLSearchParams(params);
  next.set("page", String(page));
  return `${basePath}?${next.toString()}`;
}

export function Pagination({
  page,
  totalPages,
  searchParams,
  locale,
  basePath = "/youtube",
}: {
  page: number;
  totalPages: number;
  searchParams: Record<string, string | undefined>;
  locale: Locale;
  /**
   * [PR-37] Which listing is being paged. Defaults to the digest feed, which
   * is what every existing caller wants and is the behaviour this component
   * had before the parameter existed (ported routes now live under /youtube).
   */
  basePath?: string;
}) {
  if (totalPages <= 1) return null;
  const t = translator(locale);

  const params = new URLSearchParams(
    Object.entries(searchParams).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );

  return (
    <nav className="flex items-center justify-center gap-4 pt-4 text-sm">
      {page > 1 ? (
        <a
          href={buildHref(basePath, params, page - 1)}
          className="text-[var(--color-ink)] hover:text-[var(--color-accent)]"
        >
          {t("pagination.previous")}
        </a>
      ) : (
        <span className="text-[var(--color-ink-muted)]">{t("pagination.previous")}</span>
      )}
      <span className="text-[var(--color-ink-muted)]">
        {t("pagination.position", { page, total: totalPages })}
      </span>
      {page < totalPages ? (
        <a
          href={buildHref(basePath, params, page + 1)}
          className="text-[var(--color-ink)] hover:text-[var(--color-accent)]"
        >
          {t("pagination.next")}
        </a>
      ) : (
        <span className="text-[var(--color-ink-muted)]">{t("pagination.next")}</span>
      )}
    </nav>
  );
}
