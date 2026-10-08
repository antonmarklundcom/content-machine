import Link from "next/link";
import { IDEA_STATUSES, type IdeaStatus } from "@/db/schema";
import { translator, type Locale } from "@/lib/i18n";

/**
 * Status filter tabs with counts (PLAN.md §6.S6). Plain links carrying
 * `?status=`, so a filtered list is a URL: shareable, back-button safe, and
 * rendered on the server from `listIdeas({ status })`.
 */
export function IdeaStatusTabs({
  counts,
  active,
  basePath,
  locale,
  param = "status",
}: {
  counts: Record<IdeaStatus, number>;
  /** undefined = "All". */
  active: IdeaStatus | undefined;
  /** The page being filtered, e.g. `/brand/propia`. */
  basePath: string;
  locale: Locale;
  param?: string;
}) {
  const t = translator(locale);
  const total = IDEA_STATUSES.reduce((sum, s) => sum + counts[s], 0);
  const tabs: { status: IdeaStatus | undefined; label: string; count: number }[] = [
    { status: undefined, label: t("ideas.tabs.all"), count: total },
    ...IDEA_STATUSES.map((s) => ({ status: s, label: t(`ideas.status.${s}`), count: counts[s] })),
  ];

  return (
    <nav aria-label={t("ideas.tabs.label")} className="flex flex-wrap gap-2 text-sm">
      {tabs.map((tab) => {
        const selected = tab.status === active;
        const href = tab.status ? `${basePath}?${param}=${tab.status}` : basePath;
        return (
          <Link
            key={tab.status ?? "all"}
            href={href}
            aria-current={selected ? "page" : undefined}
            className={`rounded-[var(--radius-sm)] px-3 py-1.5 font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${
              selected
                ? "bg-[var(--color-accent)] text-[var(--color-accent-ink)]"
                : "surface-border text-[var(--color-ink)] hover:border-[var(--color-accent)]"
            }`}
          >
            {tab.label} <span className="tabular-nums opacity-70">{tab.count}</span>
          </Link>
        );
      })}
    </nav>
  );
}
