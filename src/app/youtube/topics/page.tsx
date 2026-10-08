import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { formatDate } from "@/lib/format";
import { listContentTypes, listEntities, listTopics, type TagCount } from "@/lib/tags";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("topics.title") };
}

/**
 * [PR-34] The corpus described by itself (PLAN.md §7).
 *
 * Nothing here is a category the code chose. Every shelf on this page was
 * produced by an analysis reading a transcript, which is the entire point: the
 * page tells the owner what they have been watching, rather than sorting it
 * into buckets picked before the first video was ingested.
 */
export default async function TopicsPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  await requireUser();
  const params = await searchParams;
  const locale = await getLocale();
  const t = translator(locale);

  // A tag on one video is a label, not a grouping, and the long tail of them
  // buries the shelves worth opening. Shown on request rather than never.
  const showAll = params.all === "1";
  const minCount = showAll ? 1 : 2;

  const [topics, entities, contentTypes] = await Promise.all([
    listTopics({ minCount }),
    listEntities({ minCount }),
    listContentTypes(),
  ]);

  const empty = topics.length === 0 && entities.length === 0;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <p className="text-xs tracking-widest text-[var(--color-ink-muted)] uppercase">
        {t("topics.eyebrow")}
      </p>
      <h1 className="mt-1 mb-8 text-2xl font-semibold text-[var(--color-ink)]">
        {t("topics.title")}
      </h1>

      {empty ? (
        // First-class empty state (the database starts empty and stays that way
        // until an analysis has actually run — this is what day one looks like).
        <p className="max-w-prose text-sm text-[var(--color-ink-muted)]">{t("topics.empty")}</p>
      ) : (
        <div className="flex flex-col gap-10">
          <TagSection
            heading={t("topics.subjects")}
            hint={t("topics.subjectsHint")}
            kind="topic"
            tags={topics}
            locale={locale}
            emptyLabel={t("topics.none")}
          />
          <TagSection
            heading={t("topics.entities")}
            hint={t("topics.entitiesHint")}
            kind="entity"
            tags={entities}
            locale={locale}
            emptyLabel={t("topics.none")}
          />

          {contentTypes.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-[var(--color-ink)]">
                {t("topics.shapes")}
              </h2>
              <p className="mt-1 mb-3 text-xs text-[var(--color-ink-muted)]">
                {t("topics.shapesHint")}
              </p>
              <ul className="flex flex-wrap gap-2">
                {contentTypes.map((row) => (
                  <li key={row.contentType}>
                    <Link
                      href={`/youtube?type=${encodeURIComponent(row.contentType)}`}
                      className="inline-flex items-center gap-2 rounded-full border border-[var(--color-line)] px-3 py-1 text-sm text-[var(--color-ink)] transition-colors hover:border-[var(--color-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:outline-none"
                    >
                      {row.contentType}
                      <span className="text-xs text-[var(--color-ink-muted)]">
                        {row.videoCount}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <p className="text-xs text-[var(--color-ink-muted)]">
            <Link
              href={showAll ? "/youtube/topics" : "/youtube/topics?all=1"}
              className="text-[var(--color-accent)] hover:underline focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:outline-none"
            >
              {showAll ? t("topics.hideSingles") : t("topics.showSingles")}
            </Link>
          </p>
        </div>
      )}
    </main>
  );
}

function TagSection({
  heading,
  hint,
  kind,
  tags,
  locale,
  emptyLabel,
}: {
  heading: string;
  hint: string;
  kind: "topic" | "entity";
  tags: TagCount[];
  locale: Awaited<ReturnType<typeof getLocale>>;
  emptyLabel: string;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-[var(--color-ink)]">{heading}</h2>
      <p className="mt-1 mb-3 text-xs text-[var(--color-ink-muted)]">{hint}</p>
      {tags.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-muted)]">{emptyLabel}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {tags.map((tag) => (
            <li key={tag.slug}>
              <Link
                href={`/youtube/topics/${kind}/${encodeURIComponent(tag.slug)}`}
                className="flex items-baseline justify-between gap-3 rounded-lg border border-[var(--color-line)] px-3 py-2 transition-colors hover:border-[var(--color-accent)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:outline-none"
              >
                <span className="truncate text-sm text-[var(--color-ink)]">{tag.name}</span>
                <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">
                  {tag.videoCount}
                  {tag.latest ? ` · ${formatDate(tag.latest, locale)}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
