"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { LessonKind } from "@/db/schema";
import type { TranslationKey } from "@/lib/i18n";
import { useTranslator } from "@/lib/i18n/client";
import { SCRIPT_LANGUAGES, type ScriptLanguage } from "@/lib/scripts/contract";
import { STUDIO_BUTTON, STUDIO_INPUT, STUDIO_LABEL as LABEL, STUDIO_PRIMARY } from "./StudioStyles";

export type BriefVideo = { id: number; title: string; channel: string | null };
export type BriefLesson = { id: number; kind: LessonKind; text: string; shared: boolean };
type TitleSuggestion = { title: string; angle: string };

const KIND_LABEL: Record<LessonKind, TranslationKey> = {
  lesson: "studio.lessonKind.lesson",
  hook: "studio.lessonKind.hook",
  title_pattern: "studio.lessonKind.title_pattern",
  fact: "studio.lessonKind.fact",
  cta: "studio.lessonKind.cta",
  caption_pattern: "studio.lessonKind.caption_pattern",
};

async function postJson(
  url: string,
  body: unknown,
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, data };
}

/**
 * The new-script brief (PLAN.md §6.S12.1): brand, topic, language, length,
 * competitor videos and lessons → "Suggest titles" → pick one (or type one) →
 * "Write script" → the editor. Both steps are O8's owner-gated routes; their
 * `{ error }` is shown as is.
 */
export function StudioBriefForm({
  brands,
  brandId,
  videos,
  selectedRefs,
  lessons,
  initialTopic = "",
}: {
  brands: { id: string; name: string; language: ScriptLanguage }[];
  brandId: string;
  videos: BriefVideo[];
  selectedRefs: number[];
  lessons: BriefLesson[];
  initialTopic?: string;
}) {
  const t = useTranslator();
  const router = useRouter();
  const brandDefault = brands.find((b) => b.id === brandId)?.language ?? "en";

  const [topic, setTopic] = useState(initialTopic);
  const [language, setLanguage] = useState<ScriptLanguage>(brandDefault);
  const [minutes, setMinutes] = useState(8);
  const [refs, setRefs] = useState<number[]>(selectedRefs);
  const [lessonIds, setLessonIds] = useState<number[]>([]);
  const [titles, setTitles] = useState<TitleSuggestion[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState<"titles" | "script" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A brand switch reloads the page's lessons (they are per brand); the topic
  // survives, the brand-specific choices do not.
  useEffect(() => {
    setLanguage(brandDefault);
    setLessonIds([]);
    setTitles([]);
  }, [brandId, brandDefault]);

  function switchBrand(next: string) {
    const q = new URLSearchParams({ brand: next });
    for (const r of refs) q.append("ref", String(r));
    router.replace(`/studio/new?${q}`);
  }

  const toggle = (list: number[], id: number) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  async function suggestTitles() {
    setError(null);
    setBusy("titles");
    try {
      const { ok, data } = await postJson("/api/scripts/titles", {
        brandId,
        topic,
        language,
        ...(lessonIds.length ? { lessonIds } : {}),
      });
      if (!ok) return setError(String(data.error ?? t("studio.error.generic")));
      const list = (data.titles as TitleSuggestion[]) ?? [];
      setTitles(list);
      if (!title && list[0]) setTitle(list[0].title);
    } catch {
      setError(t("studio.error.generic"));
    } finally {
      setBusy(null);
    }
  }

  async function writeScript() {
    setError(null);
    setBusy("script");
    try {
      const { ok, data } = await postJson("/api/scripts", {
        brandId,
        topic,
        title,
        targetMinutes: minutes,
        language,
        competitorVideoIds: refs,
        lessonIds,
      });
      const script = data.script as { id: number } | undefined;
      if (!ok || !script) return setError(String(data.error ?? t("studio.error.generic")));
      router.push(`/studio/${script.id}`);
    } catch {
      setError(t("studio.error.generic"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <form className="mt-6 flex flex-col gap-6" onSubmit={(e) => e.preventDefault()}>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className={LABEL}>{t("studio.brief.brand")}</span>
          <select
            className={STUDIO_INPUT}
            value={brandId}
            onChange={(e) => switchBrand(e.target.value)}
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={LABEL}>{t("studio.brief.language")}</span>
          <select
            className={STUDIO_INPUT}
            value={language}
            onChange={(e) => setLanguage(e.target.value as ScriptLanguage)}
          >
            {SCRIPT_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={LABEL}>{t("studio.brief.minutes")}</span>
          <input
            type="number"
            min={1}
            max={30}
            className={STUDIO_INPUT}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
          />
        </label>
      </div>

      <label className="block">
        <span className={LABEL}>{t("studio.brief.topic")}</span>
        <textarea
          rows={2}
          className={STUDIO_INPUT}
          value={topic}
          placeholder={t("studio.brief.topicPlaceholder")}
          onChange={(e) => setTopic(e.target.value)}
        />
      </label>

      <fieldset>
        <legend className={LABEL}>{t("studio.brief.references", { n: refs.length })}</legend>
        <p className="mb-2 text-xs text-[var(--color-ink-muted)]">
          {t("studio.brief.referencesHelp")}
        </p>
        {videos.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]">{t("studio.brief.noVideos")}</p>
        ) : (
          <ul className="surface-border max-h-60 overflow-y-auto rounded-[var(--radius-sm)] p-2">
            {videos.map((v) => (
              <li key={v.id}>
                <label className="flex items-start gap-2 px-1 py-1 text-sm text-[var(--color-ink)]">
                  <input
                    type="checkbox"
                    checked={refs.includes(v.id)}
                    onChange={() => setRefs(toggle(refs, v.id))}
                  />
                  <span>
                    {v.title}
                    {v.channel && (
                      <span className="text-[var(--color-ink-muted)]"> · {v.channel}</span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <fieldset>
        <legend className={LABEL}>{t("studio.brief.lessons", { n: lessonIds.length })}</legend>
        <p className="mb-2 text-xs text-[var(--color-ink-muted)]">
          {t("studio.brief.lessonsHelp")}
        </p>
        {lessons.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-muted)]">{t("studio.brief.noLessons")}</p>
        ) : (
          <ul className="surface-border max-h-60 overflow-y-auto rounded-[var(--radius-sm)] p-2">
            {lessons.map((l) => (
              <li key={l.id}>
                <label className="flex items-start gap-2 px-1 py-1 text-sm text-[var(--color-ink)]">
                  <input
                    type="checkbox"
                    checked={lessonIds.includes(l.id)}
                    onChange={() => setLessonIds(toggle(lessonIds, l.id))}
                  />
                  <span>
                    <span className="text-xs text-[var(--color-accent)]">
                      {t(KIND_LABEL[l.kind])}
                    </span>
                    {l.shared && (
                      <span className="text-xs text-[var(--color-ink-muted)]">
                        {" "}
                        · {t("studio.brief.shared")}
                      </span>
                    )}{" "}
                    {l.text}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={STUDIO_BUTTON}
          disabled={!topic.trim() || busy !== null}
          onClick={suggestTitles}
        >
          {busy === "titles" ? t("studio.brief.suggesting") : t("studio.brief.suggest")}
        </button>
        <span className="text-xs text-[var(--color-ink-muted)]">{t("studio.brief.spends")}</span>
      </div>

      {titles.length > 0 && (
        <fieldset>
          <legend className={LABEL}>{t("studio.brief.pickTitle")}</legend>
          <ul className="flex flex-col gap-2">
            {titles.map((s) => (
              <li key={s.title}>
                <label className="surface-border flex items-start gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-sm">
                  <input
                    type="radio"
                    name="title"
                    checked={title === s.title}
                    onChange={() => setTitle(s.title)}
                  />
                  <span>
                    <span className="font-medium text-[var(--color-ink)]">{s.title}</span>
                    <span className="block text-xs text-[var(--color-ink-muted)]">{s.angle}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      <label className="block">
        <span className={LABEL}>{t("studio.brief.titleField")}</span>
        <input className={STUDIO_INPUT} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>

      {error && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={STUDIO_PRIMARY}
          disabled={!topic.trim() || !title.trim() || busy !== null}
          onClick={writeScript}
        >
          {busy === "script" ? t("studio.brief.writing") : t("studio.brief.write")}
        </button>
        {busy === "script" && (
          <span className="text-xs text-[var(--color-ink-muted)]">
            {t("studio.brief.writingHelp")}
          </span>
        )}
      </div>
    </form>
  );
}
