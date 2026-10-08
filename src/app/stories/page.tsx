import type { Metadata } from "next";
import { StoryActionForm, STORY_FIELD } from "@/components/StoryActionForm";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { translator } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { importStoriesAction } from "@/lib/stories.actions";
import { cuentosRoot } from "@/lib/stories/book";
import {
  listScenes,
  listStories,
  listStoryRenders,
  listStoryTakes,
  storyReadiness,
} from "@/lib/stories/data";
import { readStoryNotes } from "@/lib/stories/import";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("stories.title") };
}

/**
 * The cuentos library (build 4 §3.C.8): every imported book with its series,
 * age band and languages, and per language how far it is — text approved,
 * takes selected, latest render. The owner imports / re-imports here.
 */
export default async function StoriesPage() {
  const [user, locale, list] = await Promise.all([requireUser(), getLocale(), listStories()]);
  const t = translator(locale);
  const canEdit = isOwner(user);
  const root = cuentosRoot();

  const rows = await Promise.all(
    list.map(async (story) => {
      const [scenes, takes, renders] = await Promise.all([
        listScenes(story.id),
        listStoryTakes(story.slug),
        listStoryRenders(story.slug),
      ]);
      return {
        story,
        readiness: storyReadiness(story, scenes, takes, renders),
        notes: readStoryNotes(story.notes),
      };
    }),
  );

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
        {t("stories.eyebrow")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">{t("stories.title")}</h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">
        {t("stories.intro")}
      </p>

      <section className="surface-border surface-card mt-6 p-5">
        <p className="text-xs text-[var(--color-ink-muted)]">
          {root ? t("stories.root", { root }) : t("stories.noRoot")}
        </p>
        {canEdit && root && (
          <div className="mt-3">
            <StoryActionForm
              action={importStoriesAction}
              submit="stories.import.submit"
              pending="stories.import.running"
              locale={locale}
            >
              <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
                {t("stories.import.slug")}
                <input
                  name="slug"
                  placeholder={t("stories.import.allBooks")}
                  className={STORY_FIELD}
                />
              </label>
            </StoryActionForm>
          </div>
        )}
      </section>

      {rows.length === 0 ? (
        <p className="mt-8 text-sm text-[var(--color-ink-muted)]">{t("stories.empty")}</p>
      ) : (
        <ul className="mt-8 flex flex-col gap-4">
          {rows.map(({ story, readiness, notes }) => {
            const last = notes.lastImport;
            return (
              <li key={story.id} className="surface-border surface-card p-5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <a
                    href={`/stories/${encodeURIComponent(story.slug)}`}
                    className="text-lg font-semibold text-[var(--color-ink)] hover:text-[var(--color-accent)]"
                  >
                    {story.title}
                  </a>
                  {story.series && (
                    <span className="text-sm text-[var(--color-ink-muted)]">{story.series}</span>
                  )}
                  {story.ageBand && (
                    <span className="text-xs text-[var(--color-ink-muted)]">
                      {t("stories.ageBand")}: {story.ageBand}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                  {story.slug} ·{" "}
                  {t("stories.imported", { date: formatDate(story.importedAt, locale) })}
                </p>
                <table className="mt-3 w-full text-left text-sm">
                  <thead className="text-xs text-[var(--color-ink-muted)]">
                    <tr>
                      <th className="py-1 font-medium">{t("stories.col.language")}</th>
                      <th className="py-1 font-medium">{t("stories.col.text")}</th>
                      <th className="py-1 font-medium">{t("stories.col.takes")}</th>
                      <th className="py-1 font-medium">{t("stories.col.render")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {readiness.map((r) => (
                      <tr key={r.lang} className="border-t border-[var(--color-border-subtle)]">
                        <td className="py-1">
                          <a
                            href={`/stories/${encodeURIComponent(story.slug)}?lang=${r.lang}`}
                            className="font-medium hover:text-[var(--color-accent)]"
                          >
                            {r.lang}
                          </a>
                        </td>
                        <td className="py-1">
                          {r.textApproved}/{r.scenes}
                        </td>
                        <td className="py-1">
                          {r.takesSelected}/{r.scenes}
                        </td>
                        <td className="py-1 text-xs">
                          {r.latestRender
                            ? `${r.latestRender.status} · ${r.latestRender.format} · ${formatDate(r.latestRender.createdAt, locale)}`
                            : "–"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {last && (last.warnings.length > 0 || last.unknownFiles.length > 0) && (
                  <details className="mt-3 text-xs text-[var(--color-ink-muted)]">
                    <summary className="cursor-pointer">
                      {t("stories.report.summary", {
                        warnings: last.warnings.length,
                        files: last.unknownFiles.length,
                      })}
                    </summary>
                    <ul className="mt-2 list-disc pl-5">
                      {last.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                      {last.unknownFiles.map((f) => (
                        <li key={f}>
                          {t("stories.report.unknownFile")}: {f}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
