import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { listAllBrands } from "@/lib/bridge/brands";
import { listLessons } from "@/lib/bridge/lessons";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { LessonFilters } from "@/components/LessonFilters";
import { LessonRow } from "@/components/LessonRow";
import { lessonsQueryFrom, lessonsSearchString, type LessonSearchParams } from "./query";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("lessons.title") };
}

export default async function LessonsPage({
  searchParams,
}: {
  searchParams: Promise<LessonSearchParams>;
}) {
  const params = await searchParams;
  await requireUser();
  const locale = await getLocale();
  const t = translator(locale);
  const query = lessonsQueryFrom(params);
  const [rows, brands] = await Promise.all([listLessons(query), listAllBrands()]);
  const brandNames = new Map(brands.map((b) => [b.id, b.name]));
  const hasFilters =
    query.brandId !== undefined || query.kind !== undefined || query.search !== undefined;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
            {t("lessons.eyebrow")}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
            {t("lessons.title")}
          </h1>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{t("lessons.intro")}</p>
        </div>
        <a
          href={`/lessons/export${lessonsSearchString(params)}`}
          className="surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-4 py-2 text-sm font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-accent)]"
        >
          {t("lessons.export")}
        </a>
      </div>

      <LessonFilters
        locale={locale}
        brands={brands.map((b) => ({ id: b.id, name: b.name }))}
        brand={params.brand?.trim() ?? ""}
        kind={query.kind ?? ""}
        q={query.search ?? ""}
      />

      {rows.length === 0 ? (
        <p className="surface-border mt-6 rounded-[var(--radius-md)] bg-[var(--color-surface-raised)] px-4 py-8 text-center text-sm text-[var(--color-ink-muted)]">
          {t(hasFilters ? "lessons.emptyFiltered" : "lessons.empty")}
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {rows.map((lesson) => (
            <LessonRow
              key={lesson.id}
              locale={locale}
              lesson={{
                id: lesson.id,
                text: lesson.text,
                kind: lesson.kind,
                brandName: lesson.brandId
                  ? (brandNames.get(lesson.brandId) ?? lesson.brandId)
                  : null,
                videoId: lesson.videoId,
                videoTitle: lesson.videoTitle ?? lesson.videoYoutubeId,
                videoUrl: lesson.videoYoutubeId
                  ? `https://www.youtube.com/watch?v=${lesson.videoYoutubeId}${
                      lesson.timestampSec !== null ? `&t=${lesson.timestampSec}s` : ""
                    }`
                  : null,
                sourceUrl: lesson.sourceUrl,
              }}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
