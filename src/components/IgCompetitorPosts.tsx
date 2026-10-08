import { formatDate } from "@/lib/format";
import type { Locale, Translator } from "@/lib/i18n";
import type { RankedCompetitorPost } from "@/lib/meta/discovery";

/** Competitor posts ranked against each account's own median (PLAN.md §6.S21, §1.30). */
export function IgCompetitorPosts({
  posts,
  empty,
  t,
  locale,
}: {
  posts: RankedCompetitorPost[];
  empty: string;
  t: Translator;
  locale: Locale;
}) {
  if (posts.length === 0) {
    return <p className="mt-3 text-sm text-[var(--color-ink-muted)]">{empty}</p>;
  }
  return (
    <ol className="mt-3 space-y-3">
      {posts.map((p) => (
        <li key={p.id} className="surface-border rounded-[var(--radius-sm)] p-3 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-medium text-[var(--color-ink)]">
              @{p.handle}
              <span className="ml-2 text-xs font-normal text-[var(--color-ink-muted)]">
                {(p.mediaType ?? "").toLowerCase()} · {formatDate(p.postedAt, locale)}
              </span>
            </span>
            <span className="text-xs font-semibold text-[var(--color-accent)]">
              {t("ig.best.score", { score: p.score.toFixed(1) })}
            </span>
          </div>
          {p.caption ? (
            <p className="mt-1 line-clamp-3 whitespace-pre-line text-[var(--color-ink-muted)]">
              {p.caption}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
            {t("ig.best.counts", { likes: p.likes ?? 0, comments: p.comments ?? 0 })}
            {p.permalink ? (
              <>
                {" · "}
                <a
                  href={p.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-[var(--color-accent)]"
                >
                  {t("ig.open")}
                </a>
              </>
            ) : null}
          </p>
        </li>
      ))}
    </ol>
  );
}
