import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { Pagination } from "@/components/Pagination";
import { VideoCard } from "@/components/VideoCard";
import { findTagName } from "@/lib/tags";
import { listDigestVideos, parseDigestSort } from "@/lib/videos";

type Params = { kind: string; slug: string };

/** Only these two exist; anything else is a 404 rather than an empty feed. */
function parseKind(value: string): "topic" | "entity" | null {
  return value === "topic" || value === "entity" ? value : null;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { kind, slug } = await params;
  const parsed = parseKind(kind);
  if (!parsed) return {};
  const name = await findTagName(parsed, slug);
  return { title: name ?? translator(await getLocale())("topics.title") };
}

/**
 * [PR-34] One shelf: every video tagged with this topic or entity.
 *
 * This is the feed with one extra condition, not a second listing. Pagination,
 * per-user read state, the analysis badges and the cards all come from
 * listDigestVideos, so nothing here can drift out of step with the home page.
 */
export default async function TagPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ page?: string; sort?: string }>;
}) {
  const { kind, slug } = await params;
  const parsed = parseKind(kind);
  if (!parsed) notFound();

  const user = await requireUser();
  const query = await searchParams;
  const locale = await getLocale();
  const t = translator(locale);

  const name = await findTagName(parsed, slug);
  // A slug nobody has ever been tagged with is a wrong URL, not an empty shelf:
  // every tag on this page came from an analysis, so one that does not exist
  // was mistyped or has been retagged away.
  if (!name) notFound();

  const result = await listDigestVideos({
    userId: user.id,
    topicSlug: parsed === "topic" ? slug : undefined,
    entitySlug: parsed === "entity" ? slug : undefined,
    sort: parseDigestSort(query.sort),
    page: Number(query.page) || 1,
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link
        href="/youtube/topics"
        className="text-xs text-[var(--color-accent)] hover:underline focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:outline-none"
      >
        ← {t("topics.backToTopics")}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--color-ink)]">{name}</h1>
      <p className="mt-1 mb-8 text-sm text-[var(--color-ink-muted)]">
        {result.total} {t("topics.videosTagged")}
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {result.videos.map((video) => (
          <VideoCard key={video.id} video={video} locale={locale} />
        ))}
      </div>

      {result.totalPages > 1 && (
        <div className="mt-8">
          <Pagination
            page={result.page}
            totalPages={result.totalPages}
            searchParams={query}
            locale={locale}
            // Without this the links resolved to the feed, carrying only ?page
            // and ?sort — so page 2 of a shelf silently became page 2 of the
            // whole corpus. `parsed` rather than `kind`: it is the validated
            // value, and the slug is re-encoded because params arrive decoded.
            basePath={`/youtube/topics/${parsed}/${encodeURIComponent(slug)}`}
          />
        </div>
      )}
    </main>
  );
}
