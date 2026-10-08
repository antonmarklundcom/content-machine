"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MECHANIC_LABEL } from "@/app/posts/model";
import { useTranslator } from "@/lib/i18n/client";
import { savePostAction } from "@/lib/posts.actions";
import { draftKey } from "@/lib/draft-recovery";
import { DraftRecoveryNotice, useDraftRecovery } from "./useDraftRecovery";
import { partForFormat } from "@/lib/posts/assemble";
import {
  ENGAGEMENT_MECHANICS,
  STORY_STICKERS,
  type EngagementMechanic,
  type PostDraft,
  type PostShot,
  type PostSlide,
  type PostStoryFrame,
  type StorySticker,
} from "@/lib/posts/contract";
import { STUDIO_BUTTON, STUDIO_INPUT, STUDIO_LABEL, STUDIO_PRIMARY } from "./StudioStyles";

const SECTION = "surface-border surface-card px-5 py-4";
const HEADING = "mb-3 text-sm font-semibold text-[var(--color-ink)]";
const ITEM = "surface-border flex flex-col gap-3 rounded-[var(--radius-sm)] p-3";

/**
 * The draft as it is saved: optional fields that were emptied are dropped
 * (the contract rejects an empty `firstComment`, but not a missing one),
 * hashtags lose any `#`, and list items are renumbered 1..n.
 */
export function tidyDraft(draft: PostDraft): PostDraft {
  const next: PostDraft = {
    ...draft,
    hashtags: draft.hashtags.map((h) => h.replace(/^#+/, "").trim()).filter(Boolean),
  };
  for (const key of ["firstComment", "altText", "notes"] as const) {
    if (!next[key]?.trim()) delete next[key];
  }
  if (next.slides) next.slides = next.slides.map((s, i) => ({ ...s, n: i + 1 }));
  if (next.shots) {
    next.shots = next.shots.map((s, i) => {
      const shot: PostShot = { ...s, n: i + 1 };
      if (!shot.voiceover?.trim()) delete shot.voiceover;
      return shot;
    });
  }
  if (next.storyFrames) {
    next.storyFrames = next.storyFrames.map((f, i) => {
      const frame: PostStoryFrame = { ...f, n: i + 1 };
      if (!frame.sticker) delete frame.sticker;
      return frame;
    });
  }
  return next;
}

function Field({
  label,
  value,
  onChange,
  rows,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  type?: string;
}) {
  return (
    <label className="block">
      <span className={STUDIO_LABEL}>{label}</span>
      {rows ? (
        <textarea
          className={STUDIO_INPUT}
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          type={type}
          className={STUDIO_INPUT}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

/**
 * The post editor (PLAN.md §6.S15): hook, caption, CTA, hashtags, the
 * engagement mechanic, the format's slides / shots / story frames, and the
 * sources. One "Save" sends the whole draft; O11's `updatePost` validates it
 * against the contract and refreshes the caption and first comment that go
 * out. Validation errors come back as `<path> <what is wrong>` lines.
 */
export function PostEditor({
  postId,
  title: initialTitle,
  notes: initialNotes,
  draft: initialDraft,
  rawBody,
  userId,
  brandId,
  revision = 0,
}: {
  postId: number;
  title: string;
  notes: string;
  draft: PostDraft | null;
  rawBody: string | null;
  userId?: number;
  brandId?: string;
  revision?: number;
}) {
  const t = useTranslator();
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [notes, setNotes] = useState(initialNotes);
  const [draft, setDraft] = useState<PostDraft | null>(initialDraft);
  const [hashtags, setHashtags] = useState(initialDraft?.hashtags.join(" ") ?? "");
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; errors?: string[] } | null>(null);
  const [saved, setSaved] = useState(false);
  const recovery = useDraftRecovery({
    storageKey: userId != null && brandId ? draftKey(userId, brandId, "post", postId) : null,
    revision,
    initial: {
      title: initialTitle,
      notes: initialNotes,
      draft: initialDraft,
      hashtags: initialDraft?.hashtags.join(" ") ?? "",
    },
    value: { title, notes, draft, hashtags },
    dirty,
    validate: (
      value,
    ): value is { title: string; notes: string; draft: PostDraft | null; hashtags: string } => {
      if (!value || typeof value !== "object") return false;
      const row = value as {
        title?: unknown;
        notes?: unknown;
        draft?: unknown;
        hashtags?: unknown;
      };
      return (
        typeof row.title === "string" &&
        typeof row.notes === "string" &&
        typeof row.hashtags === "string" &&
        (row.draft === null ||
          (!!row.draft &&
            typeof row.draft === "object" &&
            Array.isArray((row.draft as PostDraft).hashtags)))
      );
    },
    restore: (value, changed) => {
      setTitle(value.title);
      setNotes(value.notes);
      setDraft(value.draft);
      setHashtags(value.hashtags);
      setDirty(changed);
      setSaved(false);
    },
  });

  const edit = (patch: Partial<PostDraft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
    setSaved(false);
  };
  const part = draft ? partForFormat(draft.format) : null;

  const save = () =>
    startTransition(async () => {
      setMessage(null);
      if (recovery.conflict) return;
      try {
        const body = draft
          ? tidyDraft({ ...draft, hashtags: hashtags.split(/[\s,]+/).filter(Boolean) })
          : undefined;
        const result = await savePostAction(postId, {
          title,
          notes,
          body,
          expectedRevision: revision,
        });
        if (result.ok) {
          const cleared = recovery.saved({ title, notes, draft, hashtags });
          setDirty(!cleared);
          setSaved(cleared);
          router.refresh();
        } else {
          setMessage({ text: result.error, errors: result.errors });
        }
      } catch {
        setMessage({ text: t("posts.error.generic") });
      }
    });

  const slides = draft?.slides ?? [];
  const shots = draft?.shots ?? [];
  const frames = draft?.storyFrames ?? [];
  const setSlide = (i: number, patch: Partial<PostSlide>) =>
    edit({ slides: slides.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const setShot = (i: number, patch: Partial<PostShot>) =>
    edit({ shots: shots.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const setFrame = (i: number, patch: Partial<PostStoryFrame>) =>
    edit({ storyFrames: frames.map((f, j) => (j === i ? { ...f, ...patch } : f)) });

  return (
    <div className="flex flex-col gap-6">
      <DraftRecoveryNotice recovery={recovery} />
      <section className={SECTION}>
        <div className="flex flex-col gap-4">
          <Field
            label={t("posts.field.title")}
            value={title}
            onChange={(v) => {
              setTitle(v);
              setDirty(true);
              setSaved(false);
            }}
          />
          {!draft && (
            <div>
              <p className="text-sm text-[var(--color-warn)]">{t("posts.editor.noDraft")}</p>
              {rawBody && rawBody !== "null" && (
                <pre className="mt-2 max-h-64 overflow-auto text-xs text-[var(--color-ink-muted)]">
                  {rawBody}
                </pre>
              )}
            </div>
          )}
        </div>
      </section>

      {draft && (
        <section className={SECTION}>
          <h2 className={HEADING}>{t("posts.section.copy")}</h2>
          <div className="flex flex-col gap-4">
            <Field
              label={t("posts.field.hook")}
              value={draft.hook}
              onChange={(hook) => edit({ hook })}
            />
            <Field
              label={t("posts.field.caption")}
              rows={8}
              value={draft.caption}
              onChange={(caption) => edit({ caption })}
            />
            <Field
              label={t("posts.field.cta")}
              value={draft.cta}
              onChange={(cta) => edit({ cta })}
            />
            <Field
              label={t("posts.field.hashtags")}
              value={hashtags}
              onChange={(v) => {
                setHashtags(v);
                setDirty(true);
                setSaved(false);
              }}
            />
            <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
              <label className="block">
                <span className={STUDIO_LABEL}>{t("posts.field.mechanic")}</span>
                <select
                  className={STUDIO_INPUT}
                  value={draft.engagement.mechanic}
                  onChange={(e) =>
                    edit({
                      engagement: {
                        ...draft.engagement,
                        mechanic: e.target.value as EngagementMechanic,
                      },
                    })
                  }
                >
                  {ENGAGEMENT_MECHANICS.map((m) => (
                    <option key={m} value={m}>
                      {t(MECHANIC_LABEL[m])}
                    </option>
                  ))}
                </select>
              </label>
              <Field
                label={t("posts.field.mechanicDetail")}
                value={draft.engagement.detail}
                onChange={(detail) => edit({ engagement: { ...draft.engagement, detail } })}
              />
            </div>
            <Field
              label={t("posts.field.firstComment")}
              rows={2}
              value={draft.firstComment ?? ""}
              onChange={(firstComment) => edit({ firstComment })}
            />
            <Field
              label={t("posts.field.altText")}
              rows={2}
              value={draft.altText ?? ""}
              onChange={(altText) => edit({ altText })}
            />
          </div>
        </section>
      )}

      {draft && part === "slides" && (
        <section className={SECTION}>
          <h2 className={HEADING}>{t("posts.section.slides")}</h2>
          <ol className="flex flex-col gap-3">
            {slides.map((s, i) => (
              <li key={i} className={ITEM}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--color-ink-muted)]">
                    {t("posts.slide", { n: i + 1 })}
                  </span>
                  <button
                    type="button"
                    className={STUDIO_BUTTON}
                    onClick={() => edit({ slides: slides.filter((_, j) => j !== i) })}
                  >
                    {t("posts.remove")}
                  </button>
                </div>
                <Field
                  label={t("posts.field.headline")}
                  value={s.headline}
                  onChange={(headline) => setSlide(i, { headline })}
                />
                <Field
                  label={t("posts.field.body")}
                  rows={3}
                  value={s.body}
                  onChange={(body) => setSlide(i, { body })}
                />
                <Field
                  label={t("posts.field.visualPrompt")}
                  rows={2}
                  value={s.visual.prompt}
                  onChange={(prompt) => setSlide(i, { visual: { ...s.visual, prompt } })}
                />
                <Field
                  label={t("posts.field.textOverlay")}
                  value={s.visual.textOverlay}
                  onChange={(textOverlay) => setSlide(i, { visual: { ...s.visual, textOverlay } })}
                />
              </li>
            ))}
          </ol>
          <button
            type="button"
            className={`${STUDIO_BUTTON} mt-3`}
            onClick={() =>
              edit({
                slides: [
                  ...slides,
                  {
                    n: slides.length + 1,
                    headline: "",
                    body: "",
                    visual: { prompt: "", textOverlay: "" },
                  },
                ],
              })
            }
          >
            {t("posts.addSlide")}
          </button>
        </section>
      )}

      {draft && part === "shots" && (
        <section className={SECTION}>
          <h2 className={HEADING}>{t("posts.section.shots")}</h2>
          <ol className="flex flex-col gap-3">
            {shots.map((s, i) => (
              <li key={i} className={ITEM}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--color-ink-muted)]">
                    {t("posts.shot", { n: i + 1 })}
                  </span>
                  <button
                    type="button"
                    className={STUDIO_BUTTON}
                    onClick={() => edit({ shots: shots.filter((_, j) => j !== i) })}
                  >
                    {t("posts.remove")}
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-[6rem_minmax(0,1fr)]">
                  <Field
                    label={t("posts.field.seconds")}
                    type="number"
                    value={String(s.seconds)}
                    onChange={(v) => setShot(i, { seconds: Number(v) })}
                  />
                  <Field
                    label={t("posts.field.onScreenText")}
                    value={s.onScreenText}
                    onChange={(onScreenText) => setShot(i, { onScreenText })}
                  />
                </div>
                <Field
                  label={t("posts.field.voiceover")}
                  rows={2}
                  value={s.voiceover ?? ""}
                  onChange={(voiceover) => setShot(i, { voiceover })}
                />
                <Field
                  label={t("posts.field.imagePrompt")}
                  rows={2}
                  value={s.visual.imagePrompt}
                  onChange={(imagePrompt) => setShot(i, { visual: { ...s.visual, imagePrompt } })}
                />
                <Field
                  label={t("posts.field.videoPrompt")}
                  rows={2}
                  value={s.visual.videoPrompt}
                  onChange={(videoPrompt) => setShot(i, { visual: { ...s.visual, videoPrompt } })}
                />
              </li>
            ))}
          </ol>
          <button
            type="button"
            className={`${STUDIO_BUTTON} mt-3`}
            onClick={() =>
              edit({
                shots: [
                  ...shots,
                  {
                    n: shots.length + 1,
                    seconds: 3,
                    onScreenText: "",
                    visual: { imagePrompt: "", videoPrompt: "" },
                  },
                ],
              })
            }
          >
            {t("posts.addShot")}
          </button>
        </section>
      )}

      {draft && part === "storyFrames" && (
        <section className={SECTION}>
          <h2 className={HEADING}>{t("posts.section.storyFrames")}</h2>
          <ol className="flex flex-col gap-3">
            {frames.map((f, i) => (
              <li key={i} className={ITEM}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--color-ink-muted)]">
                    {t("posts.frame", { n: i + 1 })}
                  </span>
                  <button
                    type="button"
                    className={STUDIO_BUTTON}
                    onClick={() => edit({ storyFrames: frames.filter((_, j) => j !== i) })}
                  >
                    {t("posts.remove")}
                  </button>
                </div>
                <Field
                  label={t("posts.field.text")}
                  rows={2}
                  value={f.text}
                  onChange={(text) => setFrame(i, { text })}
                />
                <label className="block">
                  <span className={STUDIO_LABEL}>{t("posts.field.sticker")}</span>
                  <select
                    className={STUDIO_INPUT}
                    value={f.sticker ?? ""}
                    onChange={(e) =>
                      setFrame(i, {
                        sticker: (e.target.value || undefined) as StorySticker | undefined,
                      })
                    }
                  >
                    <option value="">{t("posts.sticker.none")}</option>
                    {STORY_STICKERS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <Field
                  label={t("posts.field.visualPrompt")}
                  rows={2}
                  value={f.visual.prompt}
                  onChange={(prompt) => setFrame(i, { visual: { prompt } })}
                />
              </li>
            ))}
          </ol>
          <button
            type="button"
            className={`${STUDIO_BUTTON} mt-3`}
            onClick={() =>
              edit({
                storyFrames: [
                  ...frames,
                  { n: frames.length + 1, text: "", visual: { prompt: "" } },
                ],
              })
            }
          >
            {t("posts.addFrame")}
          </button>
        </section>
      )}

      {draft && (
        <section className={SECTION}>
          <h2 className={HEADING}>{t("posts.section.sources")}</h2>
          <ul className="flex flex-col gap-3">
            {draft.sources.map((s, i) => (
              <li
                key={i}
                className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
              >
                <Field
                  label={t("posts.field.claim")}
                  value={s.claim}
                  onChange={(claim) =>
                    edit({ sources: draft.sources.map((x, j) => (j === i ? { ...x, claim } : x)) })
                  }
                />
                <Field
                  label={t("posts.field.url")}
                  type="url"
                  value={s.url}
                  onChange={(url) =>
                    edit({ sources: draft.sources.map((x, j) => (j === i ? { ...x, url } : x)) })
                  }
                />
                <button
                  type="button"
                  className={STUDIO_BUTTON}
                  onClick={() => edit({ sources: draft.sources.filter((_, j) => j !== i) })}
                >
                  {t("posts.remove")}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={`${STUDIO_BUTTON} mt-3`}
            onClick={() => edit({ sources: [...draft.sources, { claim: "", url: "" }] })}
          >
            {t("posts.addSource")}
          </button>
        </section>
      )}

      <section className={SECTION}>
        <Field
          label={t("posts.field.notes")}
          rows={2}
          value={notes}
          onChange={(v) => {
            setNotes(v);
            setDirty(true);
            setSaved(false);
          }}
        />
      </section>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 bg-[var(--color-surface)] py-3">
        <button
          type="button"
          className={STUDIO_PRIMARY}
          disabled={pending || !dirty || recovery.conflict}
          onClick={save}
        >
          {pending ? t("posts.editor.saving") : t("posts.editor.save")}
        </button>
        {dirty && (
          <span className="text-xs text-[var(--color-warn)]">{t("posts.editor.unsaved")}</span>
        )}
        {saved && !dirty && (
          <span role="status" className="text-xs text-[var(--color-ink-muted)]">
            {t("posts.editor.saved")}
          </span>
        )}
        {message && (
          <div role="alert" className="w-full text-xs text-[var(--color-danger)]">
            <p>{message.text}</p>
            {message.errors?.length ? (
              <ul className="mt-1 list-disc pl-5">
                {message.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
