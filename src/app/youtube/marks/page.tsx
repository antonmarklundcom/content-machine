import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { getLocale } from "@/lib/i18n/server";
import { translator, type TranslationKey } from "@/lib/i18n";
import { isUnitType, type UnitType } from "@/lib/listen/units";
import { listMarks } from "@/lib/marks";
import { MarksFilters } from "@/components/MarksFilters";
import { Pagination } from "@/components/Pagination";

const TYPE_LABEL: Record<UnitType, TranslationKey> = {
  summary: "section.summary",
  takeaway: "listen.unit.takeaway",
  hook: "section.hook",
  timeline: "listen.unit.timeline",
  gap: "listen.unit.gap",
  idea: "listen.unit.idea",
};

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("marks.title") };
}

type SearchParams = { q?: string; type?: string; page?: string };

/**
 * [PR-37] Everything marked interesting, across every video.
 *
 * A page rather than only a feed filter, because the two answer different
 * questions. The feed's "Marked" filter lists *videos* that contain something
 * flagged; this lists the flagged passages themselves, which is what a reader
 * actually came back for — the third takeaway from a video whose title they no
 * longer remember.
 *
 * It renders the stored snapshot, not the live analysis (see schema.ts): a
 * re-analysis rewrites the JSON, and a marks list that quietly changed its own
 * wording would be worse than one that is occasionally out of date. The link
 * goes to the video, where the current text and the star both live.
 */
export default async function MarksPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const user = await requireUser();
  const locale = await getLocale();
  const t = translator(locale);

  const q = params.q?.trim() ?? "";
  const type = isUnitType(params.type) ? params.type : undefined;
  const page = Number(params.page) || 1;

  const result = await listMarks({ userId: user.id, q: q || undefined, unitType: type, page });
  const hasFilters = q !== "" || type !== undefined;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-6 flex flex-col gap-4">
        <div>
          <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
            {t("marks.title")}
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">
            {result.total} {t(result.total === 1 ? "marks.countOne" : "marks.countMany")}
          </h1>
        </div>
        <MarksFilters q={q} type={type ?? ""} locale={locale} />
      </div>

      {result.marks.length === 0 ? (
        <div className="surface-border surface-card flex min-h-[40vh] flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <h2 className="text-lg font-medium text-[var(--color-ink)]">
            {t(hasFilters ? "marks.noMatch.title" : "marks.empty.title")}
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-[var(--color-ink-muted)]">
            {t(hasFilters ? "marks.noMatch.body" : "marks.empty.body")}
          </p>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {result.marks.map((mark) => (
              <li
                key={`${mark.videoId}-${mark.unitType}-${mark.unitIndex}`}
                className="surface-border surface-card px-5 py-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link
                    href={`/youtube/video/${mark.videoId}`}
                    className="text-sm font-medium text-[var(--color-ink)] hover:text-[var(--color-accent)]"
                  >
                    {mark.videoTitle}
                  </Link>
                  <span className="text-xs text-[var(--color-ink-muted)]">
                    <span className="text-[var(--color-warn)]">★</span>{" "}
                    {t(TYPE_LABEL[mark.unitType])}
                    {" · "}
                    {formatDate(mark.createdAt, locale)}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">
                  {mark.unitText}
                </p>
                {mark.channelTitle && (
                  <p className="mt-2 text-xs text-[var(--color-ink-muted)]">{mark.channelTitle}</p>
                )}
              </li>
            ))}
          </ul>
          <div className="mt-8">
            <Pagination
              page={result.page}
              totalPages={result.totalPages}
              searchParams={params}
              locale={locale}
              basePath="/youtube/marks"
            />
          </div>
        </>
      )}
    </main>
  );
}
