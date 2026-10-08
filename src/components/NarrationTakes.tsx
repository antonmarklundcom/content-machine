"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import { translator, type Locale } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n/client";
import type { NarrationOwnerKind, VoiceLanguage } from "@/lib/voice/contract";
import type { TakeView } from "@/lib/voice/views";
import {
  listTakesAction,
  reviewTakeAction,
  selectTakeAction,
  voiceOptionsAction,
  type VoiceOption,
} from "@/lib/voice.actions";

import { HiggsfieldVoiceLineButton } from "./HiggsfieldVoiceLineButton";
import { NarrateButton } from "./NarrateButton";
import { ResultMessage } from "./ResultMessage";
import {
  VOICE_BADGE,
  VOICE_BADGE_ON,
  VOICE_BADGE_WARN,
  VOICE_BUTTON,
  VOICE_INPUT,
  VOICE_LABEL,
  voiceAssetUrl,
  voiceDuration,
  voiceUsd,
} from "./VoiceStyles";

export type NarrationTakesProps = {
  ownerKind: NarrationOwnerKind;
  ownerRef: string;
  sceneRef?: string | null;
  language: VoiceLanguage;
  /** Character key for a dialogue line; null = the narrator. */
  speaker?: string | null;
  /** The line's approved text: enables "Make a take" and prefills the upload's text. */
  text?: string;
  /** `story:<slug>` / `brand:<id>` for scoped pronunciations. */
  pronunciationScope?: string | null;
  locale?: Locale;
};

/**
 * Every take of one line (owner, scene, language, speaker), newest first:
 * player, duration, voice, cost, review, "use this take", approve/reject, an
 * upload for a recorded take (how Guaraní is voiced) and, with `text`, a
 * NarrateButton. Loads its own data, so any page can mount it.
 */
export function NarrationTakes(props: NarrationTakesProps) {
  const cookieLocale = useLocale();
  const locale = props.locale ?? cookieLocale;
  const t = translator(locale);
  const [takes, setTakes] = useState<TakeView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { ownerKind, ownerRef, sceneRef, language, speaker } = props;

  const reload = useCallback(async () => {
    const r = await listTakesAction({ ownerKind, ownerRef, sceneRef, language, speaker });
    if (r.ok) {
      setTakes(r.takes);
      setError(null);
    } else setError(`${t(r.error)}${r.detail ? ` ${r.detail}` : ""}`);
    // `t` changes identity per render; the key fields are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKind, ownerRef, sceneRef, language, speaker]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const act = (fn: () => Promise<{ ok: boolean; error?: string; detail?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.detail ?? String(r.error ?? ""));
      await reload();
    });

  return (
    <section className="flex flex-col gap-3" aria-label={t("voice.takes.title")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--color-ink)]">
          {t("voice.takes.title")}{" "}
          <span className="font-normal text-[var(--color-ink-muted)]">
            {language}
            {speaker ? ` · ${speaker}` : ""}
          </span>
        </h3>
        <button type="button" className={VOICE_BUTTON} onClick={() => void reload()}>
          {t("voice.takes.refresh")}
        </button>
      </div>

      {props.text && props.language !== "gn" && (
        <NarrateButton
          ownerKind={ownerKind}
          ownerRef={ownerRef}
          sceneRef={sceneRef}
          language={language}
          speaker={speaker}
          text={props.text}
          pronunciationScope={props.pronunciationScope}
          locale={locale}
          onDone={() => void reload()}
        />
      )}
      {props.text && props.language !== "gn" && (
        <HiggsfieldVoiceLineButton
          ownerKind={ownerKind}
          ownerRef={ownerRef}
          sceneRef={sceneRef}
          language={language}
          speaker={speaker}
          text={props.text}
          pronunciationScope={props.pronunciationScope}
          locale={locale}
          onDone={() => void reload()}
        />
      )}

      {error && <ResultMessage tone="error">{error}</ResultMessage>}

      {takes === null ? null : takes.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-muted)]">{t("voice.takes.empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {takes.map((take) => (
            <li key={take.id} className="surface-border surface-card flex flex-col gap-2 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-muted)]">
                <span className="font-medium text-[var(--color-ink)]">#{take.id}</span>
                <span>{take.profileName ?? t(`voice.provider.${take.provider}`)}</span>
                <span>· {t(`voice.provider.${take.provider}`)}</span>
                <span>· {voiceDuration(take.durationMs)}</span>
                <span>· {voiceUsd(take.costUsd)}</span>
                <span>· {new Date(take.createdAt).toLocaleString(locale)}</span>
                {take.selected && (
                  <span className={VOICE_BADGE_ON}>{t("voice.takes.selected")}</span>
                )}
                {take.status !== "done" ? (
                  <span className={VOICE_BADGE_WARN}>{t(`voice.takes.status.${take.status}`)}</span>
                ) : (
                  <span
                    className={take.reviewStatus === "rejected" ? VOICE_BADGE_WARN : VOICE_BADGE}
                  >
                    {t(`voice.takes.review.${take.reviewStatus}`)}
                  </span>
                )}
              </div>
              {take.playbackAssetId ? (
                <audio
                  controls
                  preload="none"
                  src={voiceAssetUrl(take.playbackAssetId)}
                  className="w-full"
                />
              ) : take.error ? (
                <p className="text-xs text-[var(--color-danger)]">{take.error}</p>
              ) : (
                <p className="text-xs text-[var(--color-ink-muted)]">{t("voice.noAudio")}</p>
              )}
              {take.reviewNote && (
                <p className="text-xs text-[var(--color-ink-muted)]">
                  “{take.reviewNote}”{take.reviewedBy ? ` — ${take.reviewedBy}` : ""}
                </p>
              )}
              {take.status === "done" && (
                <div className="flex flex-wrap gap-2">
                  {!take.selected && (
                    <button
                      type="button"
                      className={VOICE_BUTTON}
                      disabled={pending}
                      onClick={() => act(() => selectTakeAction(take.id))}
                    >
                      {t("voice.takes.select")}
                    </button>
                  )}
                  {take.reviewStatus !== "approved" && (
                    <button
                      type="button"
                      className={VOICE_BUTTON}
                      disabled={pending}
                      onClick={() => act(() => reviewTakeAction(take.id, "approved"))}
                    >
                      {t("voice.takes.approve")}
                    </button>
                  )}
                  {take.reviewStatus !== "rejected" && (
                    <button
                      type="button"
                      className={VOICE_BUTTON}
                      disabled={pending}
                      onClick={() => act(() => reviewTakeAction(take.id, "rejected"))}
                    >
                      {t("voice.takes.reject")}
                    </button>
                  )}
                  {take.masterAssetId && take.masterAssetId !== take.playbackAssetId && (
                    <a className={VOICE_BUTTON} href={voiceAssetUrl(take.masterAssetId)} download>
                      {t("voice.takes.download")}
                    </a>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <NarrationUpload {...props} locale={locale} onDone={() => void reload()} />
    </section>
  );
}

/** "Upload a recording": any audio file → a manual take via /api/voice/recordings. */
function NarrationUpload(props: NarrationTakesProps & { locale: Locale; onDone: () => void }) {
  const t = translator(props.locale);
  const [open, setOpen] = useState(false);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const id = `upload-${props.ownerRef}-${props.sceneRef ?? ""}-${props.language}-${props.speaker ?? ""}`;

  useEffect(() => {
    if (!open) return;
    void voiceOptionsAction().then((r) => {
      if (r.ok) {
        setVoices(
          r.voices.filter((v) => v.languages.length === 0 || v.languages.includes(props.language)),
        );
      }
    });
  }, [open, props.language]);

  if (!open) {
    return (
      <div>
        <button type="button" className={VOICE_BUTTON} onClick={() => setOpen(true)}>
          {t("voice.takes.upload")}
        </button>
      </div>
    );
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.set("ownerKind", props.ownerKind);
    form.set("ownerRef", props.ownerRef);
    form.set("sceneRef", props.sceneRef ?? "");
    form.set("language", props.language);
    form.set("speaker", props.speaker ?? "");
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/voice/recordings", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) {
        setMessage({ tone: "success", text: t("voice.takes.uploaded") });
        formRef.current?.reset();
        props.onDone();
      } else {
        setMessage({
          tone: "error",
          text: `${t("voice.error.upload")} ${json.error ?? res.status}`,
        });
      }
    } catch (error) {
      setMessage({ tone: "error", text: `${t("voice.error.upload")} ${String(error)}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form ref={formRef} onSubmit={submit} className="surface-border flex flex-col gap-2 p-3">
      <label className="flex flex-col gap-1" htmlFor={`${id}-file`}>
        <span className={VOICE_LABEL}>{t("voice.takes.upload")}</span>
        <input id={`${id}-file`} name="file" type="file" accept="audio/*,video/*" required />
      </label>
      <label className="flex flex-col gap-1" htmlFor={`${id}-voice`}>
        <span className={VOICE_LABEL}>{t("voice.takes.uploadVoice")}</span>
        <select id={`${id}-voice`} name="voiceProfileId" className={VOICE_INPUT} defaultValue="">
          <option value="">{t("voice.takes.uploadNoVoice")}</option>
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1" htmlFor={`${id}-text`}>
        <span className={VOICE_LABEL}>{t("voice.takes.uploadText")}</span>
        <textarea
          id={`${id}-text`}
          name="text"
          rows={2}
          required
          defaultValue={props.text ?? ""}
          className={VOICE_INPUT}
        />
      </label>
      <div className="flex gap-2">
        <button type="submit" className={VOICE_BUTTON} disabled={busy}>
          {busy ? t("voice.takes.uploading") : t("voice.takes.upload")}
        </button>
        <button type="button" className={VOICE_BUTTON} onClick={() => setOpen(false)}>
          {t("voice.cancel")}
        </button>
      </div>
      {message && <ResultMessage tone={message.tone}>{message.text}</ResultMessage>}
    </form>
  );
}
