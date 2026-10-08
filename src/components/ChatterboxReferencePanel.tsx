"use client";

import { useEffect, useRef, useState } from "react";

import { translator, type Locale } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n/client";
import type { ConsentStatus } from "@/lib/voice/contract";

import { ResultMessage } from "./ResultMessage";
import { VOICE_BUTTON, VOICE_LABEL } from "./VoiceStyles";

export type ChatterboxReferencePanelProps = {
  profileId: number;
  /** `settings.chatterbox.referencePath`, relative to MEDIA_ROOT; null/undefined = none yet. */
  referencePath?: string | null;
  consentStatus: ConsentStatus;
  locale?: Locale;
  /** Called with the new path after a successful upload. */
  onSaved?: (path: string) => void;
};

const RECORD_SECONDS = 10;

/**
 * The Chatterbox reference sample of one voice profile (docs/CHATTERBOX.md):
 * the current sample's player, an upload, and "record 10 s" in the browser
 * (MediaRecorder). Posts to `/api/voice/reference/<profileId>`, which
 * normalises it and refuses without consent.
 */
export function ChatterboxReferencePanel(props: ChatterboxReferencePanelProps) {
  const cookieLocale = useLocale();
  const t = translator(props.locale ?? cookieLocale);
  const [path, setPath] = useState<string | null>(props.referencePath ?? null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [recordingFor, setRecordingFor] = useState<number | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const consentOk = props.consentStatus === "signed" || props.consentStatus === "not_needed";

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  async function send(file: Blob, name: string) {
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("file", file, name);
      const res = await fetch(`/api/voice/reference/${props.profileId}`, {
        method: "POST",
        body: form,
      });
      const json = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
      if (!res.ok || !json.path) {
        setMessage({ tone: "error", text: json.error ?? t("chatterbox.reference.failed") });
        return;
      }
      setPath(json.path);
      setVersion((v) => v + 1);
      setMessage({ tone: "success", text: t("chatterbox.reference.saved") });
      props.onSaved?.(json.path);
    } catch {
      setMessage({ tone: "error", text: t("chatterbox.reference.failed") });
    } finally {
      setBusy(false);
    }
  }

  function stopRecording() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  async function startRecording() {
    setMessage(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setMessage({ tone: "error", text: t("chatterbox.reference.noMic") });
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch {
      setMessage({ tone: "error", text: t("chatterbox.reference.noMic") });
      return;
    }
    const rec = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      setRecordingFor(null);
      const type = rec.mimeType || "audio/webm";
      const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") ? "m4a" : "webm";
      void send(new Blob(chunks, { type }), `recording.${ext}`);
    };
    recorder.current = rec;
    rec.start();
    setRecordingFor(0);
    const started = Date.now();
    timer.current = setInterval(() => {
      const secs = Math.floor((Date.now() - started) / 1000);
      setRecordingFor(secs);
      if (secs >= RECORD_SECONDS) stopRecording();
    }, 250);
  }

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-[var(--color-ink)]">
        {t("chatterbox.reference.title")}
      </h3>
      <p className="text-xs text-[var(--color-ink-muted)]">{t("chatterbox.reference.help")}</p>
      <div className="space-y-1">
        <span className={VOICE_LABEL}>{t("chatterbox.reference.current")}</span>
        {path ? (
          <audio
            controls
            preload="none"
            className="w-full"
            src={`/api/voice/reference/${props.profileId}?v=${version}`}
          />
        ) : (
          <p className="text-xs text-[var(--color-ink-muted)]">{t("chatterbox.reference.none")}</p>
        )}
      </div>
      {consentOk ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className={`${VOICE_BUTTON} cursor-pointer`}>
            {busy ? t("chatterbox.reference.uploading") : t("chatterbox.reference.upload")}
            <input
              type="file"
              accept="audio/*,video/*"
              className="sr-only"
              disabled={busy || recordingFor !== null}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void send(file, file.name);
              }}
            />
          </label>
          {recordingFor === null ? (
            <button
              type="button"
              className={VOICE_BUTTON}
              disabled={busy}
              onClick={() => void startRecording()}
            >
              {t("chatterbox.reference.record")}
            </button>
          ) : (
            <button type="button" className={VOICE_BUTTON} onClick={stopRecording}>
              {t("chatterbox.reference.recording", { seconds: recordingFor })} ·{" "}
              {t("chatterbox.reference.stop")}
            </button>
          )}
        </div>
      ) : (
        <ResultMessage tone="info">{t("chatterbox.reference.consentNeeded")}</ResultMessage>
      )}
      {message ? <ResultMessage tone={message.tone}>{message.text}</ResultMessage> : null}
    </section>
  );
}
