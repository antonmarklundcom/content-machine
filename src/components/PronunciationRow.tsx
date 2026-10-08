"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { translator, type Locale } from "@/lib/i18n";
import type { LexiconReviewStatus } from "@/lib/voice/contract";
import {
  deletePronunciationAction,
  previewPronunciationAction,
  reviewPronunciationAction,
  updatePronunciationAction,
  type PreviewResult,
} from "@/lib/voice.actions";

import { PronunciationForm, type PronunciationFormValues } from "./PronunciationForm";
import { ResultMessage } from "./ResultMessage";
import {
  VOICE_BADGE,
  VOICE_BADGE_ON,
  VOICE_BADGE_WARN,
  VOICE_BUTTON,
  VOICE_INPUT,
  VOICE_LABEL,
  voiceAssetUrl,
  voiceUsd,
} from "./VoiceStyles";

export type PronunciationRowData = PronunciationFormValues & {
  id: number;
  reviewStatus: LexiconReviewStatus;
  reviewedBy: string | null;
};

export type PreviewVoice = { id: number; name: string; languages: string[] };

/** One respelling: review (with the listener's name), edit, delete, and a with/without preview. */
export function PronunciationRow({
  row,
  voices,
  locale,
}: {
  row: PronunciationRowData;
  voices: PreviewVoice[];
  locale: Locale;
}) {
  const t = translator(locale);
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [reviewer, setReviewer] = useState(row.reviewedBy ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const usable = voices.filter(
    (v) => row.language === "*" || v.languages.length === 0 || v.languages.includes(row.language),
  );
  const [voiceId, setVoiceId] = useState<number | null>(usable[0]?.id ?? null);
  const [sample, setSample] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  if (editing) {
    return (
      <li className="surface-border surface-card p-4">
        <PronunciationForm
          action={updatePronunciationAction.bind(null, row.id)}
          initial={row}
          locale={locale}
          idPrefix={`pron-${row.id}`}
          submitLabel={t("voice.save")}
          onDone={() => {
            setEditing(false);
            router.refresh();
          }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  const review = (status: LexiconReviewStatus) => {
    if (!reviewer.trim()) {
      setError(t("voice.pron.needReviewer"));
      return;
    }
    start(async () => {
      const r = await reviewPronunciationAction(row.id, status, reviewer);
      setError(r.ok ? null : `${t(r.error)}${r.detail ? ` (${r.detail})` : ""}`);
      router.refresh();
    });
  };

  const remove = () => {
    if (!window.confirm(t("voice.deleteConfirm"))) return;
    start(async () => {
      const r = await deletePronunciationAction(row.id);
      if (!r.ok) setError(t(r.error));
      router.refresh();
    });
  };

  const runPreview = () => {
    if (!voiceId) return;
    setPreview(null);
    start(async () => {
      setPreview(await previewPronunciationAction(row.id, voiceId, sample));
    });
  };

  const badge =
    row.reviewStatus === "approved"
      ? VOICE_BADGE_ON
      : row.reviewStatus === "rejected"
        ? VOICE_BADGE_WARN
        : VOICE_BADGE;
  return (
    <li className="surface-border surface-card flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-[var(--color-ink)]">{row.term}</span>
        <span aria-hidden="true" className="text-[var(--color-ink-muted)]">
          →
        </span>
        <span className="text-[var(--color-ink)]">{row.sayAs}</span>
        <span className={VOICE_BADGE}>{row.language}</span>
        <span className={VOICE_BADGE}>{row.scope}</span>
        <span className={badge}>{t(`voice.pron.status.${row.reviewStatus}`)}</span>
        {row.reviewedBy && (
          <span className="text-xs text-[var(--color-ink-muted)]">
            {t("voice.pron.reviewedBy", { name: row.reviewedBy })}
          </span>
        )}
      </div>
      {row.notes && <p className="text-xs text-[var(--color-ink-muted)]">{row.notes}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`pron-${row.id}-reviewer`}>
          {t("voice.reviewer")}
        </label>
        <input
          id={`pron-${row.id}-reviewer`}
          value={reviewer}
          onChange={(e) => setReviewer(e.target.value)}
          placeholder={t("voice.reviewerPlaceholder")}
          className={`${VOICE_INPUT} w-56`}
        />
        {row.reviewStatus !== "approved" && (
          <button
            type="button"
            className={VOICE_BUTTON}
            disabled={pending}
            onClick={() => review("approved")}
          >
            {t("voice.pron.approve")}
          </button>
        )}
        {row.reviewStatus !== "rejected" && (
          <button
            type="button"
            className={VOICE_BUTTON}
            disabled={pending}
            onClick={() => review("rejected")}
          >
            {t("voice.pron.reject")}
          </button>
        )}
        <button type="button" className={VOICE_BUTTON} onClick={() => setEditing(true)}>
          {t("voice.edit")}
        </button>
        <button type="button" className={VOICE_BUTTON} disabled={pending} onClick={remove}>
          {t("voice.delete")}
        </button>
        <button type="button" className={VOICE_BUTTON} onClick={() => setPreviewing((v) => !v)}>
          {t("voice.pron.preview")}
        </button>
      </div>
      {previewing &&
        (usable.length === 0 ? (
          <p className="text-xs text-[var(--color-ink-muted)]">{t("voice.pron.noVoices")}</p>
        ) : (
          <div className="surface-border flex flex-col gap-2 p-3">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end">
              <label className="flex flex-col gap-1" htmlFor={`pron-${row.id}-voice`}>
                <span className={VOICE_LABEL}>{t("voice.pron.previewVoice")}</span>
                <select
                  id={`pron-${row.id}-voice`}
                  value={voiceId ?? ""}
                  onChange={(e) => setVoiceId(Number(e.target.value) || null)}
                  className={VOICE_INPUT}
                >
                  {usable.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1" htmlFor={`pron-${row.id}-sample`}>
                <span className={VOICE_LABEL}>{t("voice.pron.previewSample")}</span>
                <input
                  id={`pron-${row.id}-sample`}
                  value={sample}
                  onChange={(e) => setSample(e.target.value)}
                  placeholder={row.term}
                  className={VOICE_INPUT}
                />
              </label>
              <button
                type="button"
                className={VOICE_BUTTON}
                disabled={pending}
                onClick={runPreview}
              >
                {pending ? t("voice.pron.previewing") : t("voice.pron.preview")}
              </button>
            </div>
            {preview && !preview.ok && (
              <ResultMessage tone="error">
                {t(preview.error)}
                {preview.detail ? ` ${preview.detail}` : ""}
              </ResultMessage>
            )}
            {preview?.ok && (
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ["voice.pron.without", preview.without],
                    ["voice.pron.with", preview.with],
                  ] as const
                ).map(([label, take]) => (
                  <div key={label} className="flex flex-col gap-1">
                    <span className={VOICE_LABEL}>
                      {t(label)} · {voiceUsd(take.costUsd)}
                    </span>
                    <span className="text-xs text-[var(--color-ink)]">{take.text}</span>
                    {take.assetId ? (
                      <audio
                        controls
                        preload="none"
                        src={voiceAssetUrl(take.assetId)}
                        className="w-full"
                      />
                    ) : (
                      <span className="text-xs text-[var(--color-ink-muted)]">
                        {t("voice.noAudio")}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      {error && <ResultMessage tone="error">{error}</ResultMessage>}
    </li>
  );
}
