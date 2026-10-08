"use client";

import { useEffect, useState, useTransition } from "react";

import type { HiggsfieldJobStatus } from "@/db/schema";
import {
  previewScriptVoiceAction,
  previewStoryVoiceAction,
  queueScriptVoiceAction,
  queueStoryVoiceAction,
  type HfVoicePreview,
} from "@/lib/higgsfield-voice.actions";
import { translator, type Locale } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n/client";
import { voiceLanguageFor } from "@/lib/stories/rules";
import type { HiggsfieldProfileOption } from "@/lib/voice/higgsfield-takes";

import { HiggsfieldVoiceStatus, type QueuedVoiceJob } from "./HiggsfieldVoiceStatus";
import { ResultMessage } from "./ResultMessage";
import { VOICE_BUTTON, VOICE_INPUT, VOICE_LABEL, VOICE_PRIMARY } from "./VoiceStyles";

export type HiggsfieldVoiceBatchButtonProps = {
  /** A book's language (`targetRef` = slug) or a script (`targetRef` = script id). */
  kind: "story" | "script";
  targetRef: string | number;
  /** Story text language (`es`, `jopara` …) or the script's voice language. */
  language: string;
  /** Active Higgsfield profiles (`listHiggsfieldProfiles()`); the narrator is picked here. */
  profiles: HiggsfieldProfileOption[];
  defaultMaxCredits?: number;
  locale?: Locale;
};

/**
 * "Narrate with Higgsfield" for a whole book language or a script (build 5
 * §3.A): pick the voice, see how many lines and the estimated credits, set the
 * ceiling, queue one `voice` job and follow it.
 */
export function HiggsfieldVoiceBatchButton(props: HiggsfieldVoiceBatchButtonProps) {
  const cookieLocale = useLocale();
  const t = translator(props.locale ?? cookieLocale);
  const voiceLang =
    props.kind === "story" ? (voiceLanguageFor(props.language) ?? props.language) : props.language;
  const usable = props.profiles.filter(
    (p) =>
      p.role === "narrator" &&
      !p.characterKey &&
      (p.languages.length === 0 || p.languages.includes(voiceLang)),
  );
  const [open, setOpen] = useState(false);
  const [profileId, setProfileId] = useState<number | null>(usable[0]?.id ?? null);
  const [preview, setPreview] = useState<HfVoicePreview | null>(null);
  const [maxCredits, setMaxCredits] = useState(String(props.defaultMaxCredits ?? 20));
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<QueuedVoiceJob | null>(null);
  const [estimating, startEstimate] = useTransition();
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open || !profileId) return;
    setError(null);
    startEstimate(async () => {
      const r =
        props.kind === "story"
          ? await previewStoryVoiceAction(String(props.targetRef), props.language, profileId)
          : await previewScriptVoiceAction(Number(props.targetRef), profileId);
      if (!r.ok) {
        setPreview(null);
        setError(r.error);
        return;
      }
      setPreview(r);
      setMaxCredits((current) =>
        Number(current) < r.estimateCredits ? String(Math.ceil(r.estimateCredits)) : current,
      );
    });
  }, [open, profileId, props.kind, props.targetRef, props.language]);

  if (!usable.length) {
    return <p className="text-xs text-[var(--color-ink-muted)]">{t("hfVoice.batch.noProfiles")}</p>;
  }

  const queue = () => {
    if (!profileId) return;
    setError(null);
    start(async () => {
      const r =
        props.kind === "story"
          ? await queueStoryVoiceAction(
              String(props.targetRef),
              props.language,
              profileId,
              Number(maxCredits),
            )
          : await queueScriptVoiceAction(Number(props.targetRef), profileId, Number(maxCredits));
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
      setJob({
        id: r.jobId,
        status: r.status as HiggsfieldJobStatus,
        lines: r.lines,
        credits: r.estimateCredits,
      });
    });
  };

  const id = `hf-voice-${props.kind}-${props.targetRef}-${props.language}`;
  return (
    <div className="flex flex-col gap-2">
      {!open ? (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={VOICE_BUTTON} onClick={() => setOpen(true)}>
            {t("hfVoice.batch.title")}
          </button>
          <span className="text-xs text-[var(--color-ink-muted)]">{t("hfVoice.batch.pcOnly")}</span>
        </div>
      ) : (
        <div className="surface-border flex flex-col gap-3 rounded-[var(--radius-sm)] p-3">
          <p className="text-xs text-[var(--color-ink-muted)]">
            {props.kind === "story"
              ? t("hfVoice.batch.storyIntro", { language: props.language })
              : t("hfVoice.batch.scriptIntro")}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1" htmlFor={`${id}-voice`}>
              <span className={VOICE_LABEL}>{t("hfVoice.batch.voice")}</span>
              <select
                id={`${id}-voice`}
                className={`${VOICE_INPUT} w-auto`}
                value={profileId ?? ""}
                onChange={(e) => setProfileId(Number(e.target.value) || null)}
                disabled={pending}
              >
                {usable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {[p.name, p.model, p.variant].filter(Boolean).join(" · ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-32 flex-col gap-1" htmlFor={`${id}-max`}>
              <span className={VOICE_LABEL}>{t("hfVoice.batch.maxCredits")}</span>
              <input
                id={`${id}-max`}
                type="number"
                min={1}
                step={1}
                value={maxCredits}
                onChange={(e) => setMaxCredits(e.target.value)}
                className={VOICE_INPUT}
              />
            </label>
            <button
              type="button"
              className={VOICE_PRIMARY}
              onClick={queue}
              disabled={
                pending ||
                estimating ||
                !preview ||
                preview.lines === 0 ||
                !(Number(maxCredits) > 0)
              }
            >
              {t("hfVoice.batch.start")}
            </button>
            <button
              type="button"
              className={VOICE_BUTTON}
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              {t("hfVoice.batch.dismiss")}
            </button>
          </div>
          <p className="text-sm text-[var(--color-ink)]">
            {estimating || !preview
              ? t("hfVoice.batch.estimating")
              : preview.lines === 0
                ? t("hfVoice.batch.nothing")
                : t("hfVoice.batch.summary", {
                    lines: preview.lines,
                    credits: preview.estimateCredits,
                  })}
          </p>
          {preview && preview.refused.length > 0 && (
            <div className="text-xs text-[var(--color-ink-muted)]">
              {t("hfVoice.batch.refused", { count: preview.refused.length })}
              <ul className="ml-4 list-disc">
                {preview.refused.map((r, i) => (
                  <li key={i}>
                    {r.sceneRef ? `${r.sceneRef}: ` : ""}
                    {r.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {preview && preview.notes.length > 0 && (
            <ul className="ml-4 list-disc text-xs text-[var(--color-ink-muted)]">
              {preview.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          <p className="text-xs text-[var(--color-ink-muted)]">
            {t("hfVoice.batch.maxCreditsHint")}
          </p>
        </div>
      )}
      {error && <ResultMessage tone="error">{error}</ResultMessage>}
      {job && <HiggsfieldVoiceStatus job={job} t={t} />}
    </div>
  );
}
