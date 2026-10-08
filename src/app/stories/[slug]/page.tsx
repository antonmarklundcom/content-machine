import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RenderAutoRefresh } from "@/components/RenderAutoRefresh";
import { HiggsfieldVoiceBatchButton } from "@/components/HiggsfieldVoiceBatchButton";
import { StoryActionButton } from "@/components/StoryActionButton";
import { defaultMaxCredits } from "@/lib/higgsfield/config";
import { listHiggsfieldProfiles } from "@/lib/voice/higgsfield-takes";
import { StoryActionForm, STORY_FIELD } from "@/components/StoryActionForm";
import { StorySceneCard } from "@/components/StorySceneCard";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { translator, type TranslationKey } from "@/lib/i18n";
import { listMusicTracks } from "@/lib/media/music";
import { MUSIC_DB_CHOICES, MUSIC_DB_DEFAULT } from "@/lib/media/music-levels";
import { getLocale } from "@/lib/i18n/server";
import { approveLanguageAction, exportStoryAction, renderStoryAction } from "@/lib/stories.actions";
import { isSafeSlug } from "@/lib/stories/book";
import {
  getStory,
  listActiveProfiles,
  listScenes,
  listStoryRenders,
  listStoryTakes,
  narratorProfilesFor,
  storyReadiness,
} from "@/lib/stories/data";
import { readStoryNotes } from "@/lib/stories/import";
import { scenePadMs, ttsAllowed, voiceLanguageFor } from "@/lib/stories/rules";
import { VIDEO_FORMATS } from "@/lib/video/contract";
import { formatDuration, isActive } from "@/lib/video/view";

type Params = { slug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const story = isSafeSlug(slug) ? await getStory(slug) : null;
  return { title: story?.title ?? translator(await getLocale())("stories.title") };
}

const CHIP =
  "rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
const CHIP_ON = `${CHIP} bg-[var(--color-accent)] text-[var(--color-accent-ink)]`;
const CHIP_OFF = `${CHIP} surface-border text-[var(--color-ink)] hover:border-[var(--color-accent)]`;

/**
 * One book (build 4 §3.C.8): a scene grid for one language (`?lang=`), and the
 * story-level render, renders list and export to cuentos.
 */
export default async function StoryPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const [{ slug }, query, user, locale] = await Promise.all([
    params,
    searchParams,
    requireUser(),
    getLocale(),
  ]);
  if (!isSafeSlug(slug)) notFound();
  const story = await getStory(slug);
  if (!story) notFound();
  const t = translator(locale);
  const canEdit = isOwner(user);

  const [scenes, takes, renders, profiles, musicTracks] = await Promise.all([
    listScenes(story.id),
    listStoryTakes(story.slug),
    listStoryRenders(story.slug),
    listActiveProfiles(),
    canEdit ? listMusicTracks() : Promise.resolve([]),
  ]);
  const renderActive = renders.some((r) => isActive(r.status));
  const langs = story.languages.length ? story.languages : ["es"];
  const lang = query.lang && langs.includes(query.lang) ? query.lang : langs[0];
  const voiceLang = voiceLanguageFor(lang);
  const narrators = narratorProfilesFor(profiles, lang);
  const readiness = storyReadiness(story, scenes, takes, renders).find((r) => r.lang === lang);
  const last = readStoryNotes(story.notes).lastImport;
  const hfProfiles = canEdit ? await listHiggsfieldProfiles() : [];

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
        <Link href="/stories" className="hover:underline">
          {t("stories.eyebrow")}
        </Link>
        {story.series ? ` · ${story.series}` : ""}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">{story.title}</h1>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
        {story.sourcePath}
        {story.ageBand ? ` · ${t("stories.ageBand")}: ${story.ageBand}` : ""} ·{" "}
        {t("stories.pad", { ms: scenePadMs(story.ageBand) })} ·{" "}
        {t("stories.imported", { date: formatDate(story.importedAt, locale) })}
      </p>

      <nav aria-label={t("stories.col.language")} className="mt-5 flex flex-wrap gap-2">
        {langs.map((l) => (
          <a
            key={l}
            href={`/stories/${encodeURIComponent(slug)}?lang=${l}`}
            aria-current={l === lang ? "page" : undefined}
            className={l === lang ? CHIP_ON : CHIP_OFF}
          >
            {l}
            {voiceLanguageFor(l) ? ` (${voiceLanguageFor(l)})` : ""}
          </a>
        ))}
      </nav>
      {readiness && (
        <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
          {t("stories.readiness", {
            text: readiness.textApproved,
            takes: readiness.takesSelected,
            audio: readiness.audioBuilt,
            total: readiness.scenes,
          })}
        </p>
      )}
      {canEdit && ttsAllowed(lang) && hfProfiles.length > 0 && (
        <div className="mt-3">
          <HiggsfieldVoiceBatchButton
            kind="story"
            targetRef={story.slug}
            language={lang}
            profiles={hfProfiles}
            defaultMaxCredits={defaultMaxCredits()}
            locale={locale}
          />
        </div>
      )}
      {canEdit && (
        <p className="mt-2 text-sm">
          <Link
            href={`/voice/record?source=${encodeURIComponent(`story:${slug}:${lang}`)}`}
            className="text-[var(--color-accent)] hover:underline"
          >
            {t("record.title")} →
          </Link>
        </p>
      )}
      {canEdit && ttsAllowed(lang) && readiness && readiness.textApproved < readiness.scenes && (
        <div className="mt-3 flex flex-col gap-1">
          <StoryActionButton
            action={approveLanguageAction.bind(null, slug, lang)}
            label="stories.approveAll.button"
            labelVars={{ lang }}
            locale={locale}
          />
          <p className="text-xs text-[var(--color-ink-muted)]">
            {t("stories.approveAll.hint", { lang })}
          </p>
        </div>
      )}

      <section className="surface-border surface-card mt-6 flex flex-col gap-4 p-5">
        <h2 className="text-base font-semibold text-[var(--color-ink)]">
          {t("stories.render.title")}
        </h2>
        <p className="text-xs text-[var(--color-ink-muted)]">{t("stories.render.note")}</p>
        {canEdit && voiceLang && (
          <StoryActionForm
            action={renderStoryAction.bind(null, slug)}
            submit="stories.render.submit"
            pending="stories.render.running"
            locale={locale}
          >
            <input type="hidden" name="lang" value={lang} />
            <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
              {t("stories.render.format")}
              <select name="format" className={STORY_FIELD} defaultValue="16x9">
                {VIDEO_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
              {t("stories.render.music")}
              <select name="music" className={STORY_FIELD} defaultValue="">
                <option value="">{t("stories.render.musicNone")}</option>
                {musicTracks.map((m) => (
                  <option key={m.path} value={m.path}>
                    {m.name}
                    {m.durationSec != null ? ` (${formatDuration(m.durationSec * 1000)})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
              {t("stories.render.musicDb")}
              <select name="musicDb" className={STORY_FIELD} defaultValue={MUSIC_DB_DEFAULT}>
                {MUSIC_DB_CHOICES.map((d) => (
                  <option key={d} value={d}>
                    {d} dB
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
              {t("stories.render.mode")}
              <select name="mode" className={STORY_FIELD} defaultValue="sample">
                <option value="sample">{t("stories.render.sample")}</option>
                <option value="full">{t("stories.render.full")}</option>
              </select>
            </label>
          </StoryActionForm>
        )}
        <RenderAutoRefresh active={renderActive} />
        {renderActive && (
          <p className="text-xs text-[var(--color-ink-muted)]">
            {t("stories.render.active")}{" "}
            <Link href="/video" className="text-[var(--color-accent)] hover:underline">
              {t("stories.render.all")}
            </Link>
          </p>
        )}
        {renders.length > 0 ? (
          <ul className="flex flex-col gap-1 text-xs">
            {renders.slice(0, 12).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">#{r.id}</span>
                <span>
                  {r.language} · {r.format} ·{" "}
                  {t(`videoRender.status.${r.status}` as TranslationKey)}
                  {r.durationMs ? ` · ${(r.durationMs / 1000).toFixed(1)} s` : ""} ·{" "}
                  {formatDate(r.createdAt, locale)}
                </span>
                {r.outputAssetId && (
                  <a
                    className="text-[var(--color-accent)] hover:underline"
                    href={`/api/media/asset/${r.outputAssetId}`}
                  >
                    MP4
                  </a>
                )}
                {r.srtAssetId && (
                  <a
                    className="text-[var(--color-accent)] hover:underline"
                    href={`/api/media/asset/${r.srtAssetId}`}
                  >
                    SRT
                  </a>
                )}
                {r.vttAssetId && (
                  <a
                    className="text-[var(--color-accent)] hover:underline"
                    href={`/api/media/asset/${r.vttAssetId}`}
                  >
                    VTT
                  </a>
                )}
                {r.error && <span className="text-[var(--color-danger)]">{r.error}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-[var(--color-ink-muted)]">{t("stories.render.none")}</p>
        )}
        {canEdit && (
          <div className="border-t border-[var(--color-border-subtle)] pt-4">
            <h3 className="text-sm font-semibold text-[var(--color-ink)]">
              {t("stories.export.title")}
            </h3>
            <p className="mt-1 mb-2 text-xs text-[var(--color-ink-muted)]">
              {t("stories.export.note", { lang })}
            </p>
            <StoryActionForm
              action={exportStoryAction.bind(null, slug)}
              submit="stories.export.submit"
              pending="stories.export.running"
              locale={locale}
            >
              <input type="hidden" name="lang" value={lang} />
            </StoryActionForm>
          </div>
        )}
      </section>

      {last && (last.warnings.length > 0 || last.unknownFiles.length > 0) && (
        <details className="mt-4 text-xs text-[var(--color-ink-muted)]">
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

      <ul className="mt-6 flex flex-col gap-4">
        {scenes.map((scene) => (
          <StorySceneCard
            key={scene.id}
            slug={slug}
            scene={scene}
            lang={lang}
            takes={takes}
            profiles={profiles}
            narrators={narrators}
            canEdit={canEdit}
            locale={locale}
          />
        ))}
      </ul>
    </main>
  );
}
