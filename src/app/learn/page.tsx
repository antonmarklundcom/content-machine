import type { Metadata } from "next";

import { LearnCard } from "@/components/LearnCard";
import { LearnFilters } from "@/components/LearnFilters";
import { Pagination } from "@/components/Pagination";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { translator } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { learnCategoryCounts, listLearnClips } from "@/lib/learn/list";
import { learnQueryFrom, type LearnSearchParams } from "@/lib/learn/query";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("learn.title") };
}

/**
 * /learn (docs/PLAN-build4.md §1.13): the aiinsights dashboard, inside
 * content-engine. Owner-only — it is Anton's own to-try list, and every
 * button on it spends or deletes.
 */
export default async function LearnPage({
  searchParams,
}: {
  searchParams: Promise<LearnSearchParams>;
}) {
  const params = await searchParams;
  const [user, locale] = await Promise.all([requireUser(), getLocale()]);
  const t = translator(locale);

  if (!isOwner(user)) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-semibold text-[var(--color-ink)]">{t("learn.title")}</h1>
        <p className="surface-card mt-6 p-4 text-sm">{t("learn.ownerOnly")}</p>
      </main>
    );
  }

  const query = learnQueryFrom(params);
  const [result, counts] = await Promise.all([listLearnClips(query), learnCategoryCounts(query)]);
  const hasFilters = Boolean(
    query.category || query.implemented || query.committed || query.search,
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-6">
        <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
          {t("learn.eyebrow")}
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
          {t("learn.title")} · {result.total}{" "}
          {t(result.total === 1 ? "learn.countOne" : "learn.countMany")}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{t("learn.intro")}</p>
      </div>

      <LearnFilters locale={locale} query={query} counts={counts} />

      {result.clips.length === 0 ? (
        <div className="surface-border surface-card mt-6 flex flex-col items-center gap-3 px-6 py-16 text-center">
          <h2 className="text-lg font-medium text-[var(--color-ink)]">
            {t(hasFilters ? "learn.noMatch.title" : "learn.empty.title")}
          </h2>
          <p className="max-w-md text-sm text-[var(--color-ink-muted)]">
            {t(hasFilters ? "learn.noMatch.body" : "learn.empty.body")}
          </p>
        </div>
      ) : (
        <>
          <ul className="mt-6 flex flex-col gap-3">
            {result.clips.map((clip) => (
              <LearnCard key={clip.id} clip={clip} locale={locale} />
            ))}
          </ul>
          <div className="mt-8">
            <Pagination
              page={result.page}
              totalPages={result.totalPages}
              searchParams={{ ...params }}
              locale={locale}
              basePath="/learn"
            />
          </div>
        </>
      )}

      <p className="mt-8 text-xs text-[var(--color-ink-muted)]">{t("learn.captureHint")}</p>
    </main>
  );
}
