"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { translator, type Locale, type TranslationKey } from "@/lib/i18n";
import { recordSessionAction } from "@/lib/record.actions";
import {
  analyzeTake,
  CLIP_LEVEL,
  extensionFor,
  levelOf,
  mixDown,
  pickMimeType,
  type TakeAnalysis,
} from "@/lib/voice/record/analyze";
import { nextUnrecorded, stepLine, type LineState } from "@/lib/voice/record/resume";
import type { RecordSession } from "@/lib/voice/record/session";

import { RecorderMeter } from "./RecorderMeter";
import { RECORD_KEPT_EVENT } from "./RecorderTips";
import {
  VOICE_BADGE,
  VOICE_BADGE_ON,
  VOICE_BADGE_WARN,
  VOICE_BUTTON,
  VOICE_LABEL,
  VOICE_INPUT,
  VOICE_PRIMARY,
  voiceDuration,
} from "./VoiceStyles";

type Phase = "idle" | "countdown" | "recording" | "review" | "saving";

type Take = { blob: Blob; url: string; mime: string; analysis: TakeAnalysis | null };

/** Where the keyboard flow must not steal keys. */
function typingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "SELECT" ||
    el.tagName === "TEXTAREA" ||
    el.isContentEditable
  );
}

async function decode(blob: Blob, text: string): Promise<TakeAnalysis | null> {
  try {
    const ctx = new AudioContext();
    try {
      const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
      const channels = Array.from({ length: audio.numberOfChannels }, (_, i) =>
        audio.getChannelData(i),
      );
      return analyzeTake(mixDown(channels), audio.sampleRate, text);
    } finally {
      void ctx.close();
    }
  } catch {
    return null;
  }
}

/**
 * The teleprompter and recorder (build 5 §3.B, docs/RECORDING.md). Big text of
 * the current line (the next one dimmed), the microphone of your choice through
 * MediaRecorder, an optional 3-2-1 count-in, a live level meter, and after each
 * take: playback, level/silence/length warnings, Keep or Redo. Keys: Space
 * record/stop, Enter keep & next, R redo, ←/→ previous/next line.
 */
export function RecorderStudio({ initial, locale }: { initial: RecordSession; locale: Locale }) {
  const t = translator(locale);
  const [session, setSession] = useState(initial);
  const [index, setIndex] = useState(
    initial.progress.resumeIndex ?? Math.max(0, stepLine(initial.lines, -1, 1)),
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [countdown, setCountdown] = useState(0);
  const [countIn, setCountIn] = useState(true);
  const [autoSelect, setAutoSelect] = useState(true);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [micOn, setMicOn] = useState(false);
  const [level, setLevel] = useState({ peak: 0, rms: 0 });
  const [clipHold, setClipHold] = useState(false);
  const [take, setTake] = useState<Take | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedRef = useRef(0);
  const clipTimerRef = useRef<number | null>(null);

  const lines = session.lines;
  const line: LineState | undefined = lines[index];
  const nextIndex = stepLine(lines, index, 1);
  const next = nextIndex !== index ? lines[nextIndex] : undefined;
  const blocked = !!session.refusal || !line || !!line.locked;

  // ---------------------------------------------------------------- microphone

  const stopMic = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((tr) => tr.stop());
    streamRef.current = null;
    void ctxRef.current?.close();
    ctxRef.current = null;
    setMicOn(false);
    setLevel({ peak: 0, rms: 0 });
  }, []);

  const startMic = useCallback(
    async (wanted: string) => {
      setError(null);
      stopMic();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: wanted ? { exact: wanted } : undefined,
            channelCount: 1,
            // A narration master wants the raw voice; the room is handled by the narrator.
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
        streamRef.current = stream;
        const all = await navigator.mediaDevices.enumerateDevices();
        setDevices(all.filter((d) => d.kind === "audioinput"));
        const used = stream.getAudioTracks()[0]?.getSettings().deviceId ?? wanted;
        setDeviceId(used ?? "");
        const ctx = new AudioContext();
        ctxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(buf);
          const l = levelOf(buf);
          setLevel(l);
          if (l.peak >= CLIP_LEVEL) {
            setClipHold(true);
            if (clipTimerRef.current !== null) window.clearTimeout(clipTimerRef.current);
            clipTimerRef.current = window.setTimeout(() => setClipHold(false), 1500);
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
        setMicOn(true);
      } catch (e) {
        setError(`${t("record.error.mic")} ${e instanceof Error ? e.message : ""}`.trim());
      }
    },
    // `t` changes identity per render; the locale is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stopMic, locale],
  );

  useEffect(
    () => () => {
      stopMic();
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    },
    [stopMic],
  );

  useEffect(
    () => () => {
      if (take) URL.revokeObjectURL(take.url);
    },
    [take],
  );

  // ---------------------------------------------------------------- recording

  const beginRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const mime = pickMimeType((type) => MediaRecorder.isTypeSupported(type));
    let rec: MediaRecorder;
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (e) {
      setError(`${t("record.error.recorder")} ${e instanceof Error ? e.message : ""}`.trim());
      setPhase("idle");
      return;
    }
    chunksRef.current = [];
    rec.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    const text = line?.text ?? "";
    rec.onstop = () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      const type = rec.mimeType || mime || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      const url = URL.createObjectURL(blob);
      setTake({ blob, url, mime: type, analysis: null });
      setPhase("review");
      void decode(blob, text).then((analysis) =>
        setTake((cur) => (cur && cur.url === url ? { ...cur, analysis } : cur)),
      );
    };
    recorderRef.current = rec;
    rec.start();
    startedRef.current = Date.now();
    setElapsedMs(0);
    timerRef.current = window.setInterval(() => setElapsedMs(Date.now() - startedRef.current), 100);
    setPhase("recording");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line, locale]);

  // The count-in runs off `countdown`: 3 → 2 → 1 → record.
  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdown <= 0) {
      beginRecording();
      return;
    }
    const id = window.setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [phase, countdown, beginRecording]);

  const discardTake = useCallback(() => {
    setTake(null);
  }, []);

  const record = useCallback(() => {
    if (blocked || !micOn) return;
    setError(null);
    setNotice(null);
    discardTake();
    if (countIn) {
      setCountdown(3);
      setPhase("countdown");
    } else beginRecording();
  }, [blocked, micOn, countIn, beginRecording, discardTake]);

  const stop = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, []);

  const goTo = useCallback(
    (i: number) => {
      if (phase === "recording" || phase === "saving" || phase === "countdown") return;
      discardTake();
      setPhase("idle");
      setError(null);
      setIndex(Math.max(0, Math.min(lines.length - 1, i)));
    },
    [phase, lines.length, discardTake],
  );

  const keep = useCallback(async () => {
    if (!take || !line || phase !== "review") return;
    setPhase("saving");
    setError(null);
    const form = new FormData();
    form.set("file", take.blob, `take.${extensionFor(take.mime)}`);
    form.set("source", session.sourceKey);
    form.set("slot", line.slot);
    form.set("voiceProfileId", String(session.profile.id));
    form.set("text", line.text);
    form.set("autoSelect", autoSelect ? "1" : "0");
    try {
      const res = await fetch("/voice/record/upload", { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        reason?: string;
        selected?: boolean;
        durationMs?: number;
        notes?: string[];
      };
      if (!res.ok) {
        setError(body.error ?? `${t("record.error.failed")} (${res.status})`);
        setPhase("review");
        return;
      }
      const refreshed = await recordSessionAction(session.sourceKey, session.profile.id);
      const states = refreshed.ok ? refreshed.session.lines : lines;
      if (refreshed.ok) setSession(refreshed.session);
      window.dispatchEvent(new Event(RECORD_KEPT_EVENT));
      setNotice(
        t(body.selected ? "record.kept.selected" : "record.kept", {
          line: line.label,
          seconds: ((body.durationMs ?? 0) / 1000).toFixed(1),
        }) + (body.notes?.length ? ` ${body.notes.join(" ")}` : ""),
      );
      setTake(null);
      setPhase("idle");
      const after = stepLine(states, index, 1);
      setIndex(after !== index ? after : (nextUnrecorded(states, index) ?? index));
    } catch (e) {
      setError(`${t("record.error.failed")} ${e instanceof Error ? e.message : ""}`.trim());
      setPhase("review");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [take, line, phase, session, autoSelect, index, lines, locale]);

  const redo = useCallback(() => {
    if (phase !== "review" && phase !== "idle") return;
    record();
  }, [phase, record]);

  // ---------------------------------------------------------------- keyboard

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typingTarget(e.target)) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (e.repeat) return;
        if (phase === "recording") stop();
        else if (phase === "countdown") setPhase("idle");
        else if (phase === "idle" || phase === "review") record();
      } else if (e.key === "Enter") {
        e.preventDefault();
        void keep();
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        redo();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goTo(stepLine(lines, index, 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goTo(stepLine(lines, index, -1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, stop, record, keep, redo, goTo, lines, index]);

  // ---------------------------------------------------------------- view

  const p = session.progress;
  const warnings = take?.analysis?.warnings ?? [];
  const blur = (e: React.MouseEvent<HTMLElement>) => e.currentTarget.blur();

  return (
    <section className="flex min-w-0 flex-col gap-4">
      {/* Progress */}
      <div className="surface-border surface-card flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-[var(--color-ink)]">{session.title}</p>
          <p className="text-xs text-[var(--color-ink-muted)]">
            {session.profile.name} · {session.voiceLanguage}
          </p>
        </div>
        <p className="text-[var(--color-ink)]">
          {t("record.progress.lines", { recorded: p.recorded, total: p.total })}
        </p>
        <p className="text-[var(--color-ink)]">
          {t("record.progress.minutes", { minutes: (p.recordedMs / 60000).toFixed(1) })}
        </p>
        {p.locked > 0 && (
          <p className="text-[var(--color-ink-muted)]">
            {t("record.progress.locked", { count: p.locked })}
          </p>
        )}
        {p.resumeIndex === null && p.total > 0 && (
          <span className={VOICE_BADGE_ON}>{t("record.progress.done")}</span>
        )}
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-raised)]">
          <div
            className="h-full bg-[var(--color-accent)]"
            style={{ width: `${p.total ? (p.recorded / p.total) * 100 : 0}%` }}
          />
        </div>
      </div>

      {session.refusal && (
        <div
          role="alert"
          className="rounded-[var(--radius-sm)] border border-[var(--color-danger)] p-4 text-sm text-[var(--color-danger)]"
        >
          <strong>{t("record.refused")}</strong> {session.refusal}
        </div>
      )}

      {/* Teleprompter */}
      <div className="surface-border surface-card p-6">
        {line ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-muted)]">
              <span className="font-mono">
                {index + 1}/{lines.length}
              </span>
              <span className={VOICE_BADGE}>{line.label}</span>
              {line.speaker && <span className={VOICE_BADGE}>{line.speaker}</span>}
              {line.takeCount > 0 && (
                <span className={VOICE_BADGE_ON}>
                  {t("record.line.recorded", { count: line.takeCount })}
                </span>
              )}
              {line.hasSelected && <span className={VOICE_BADGE}>{t("record.line.selected")}</span>}
              {line.locked && <span className={VOICE_BADGE_WARN}>{t("record.line.locked")}</span>}
            </div>
            {line.locked ? (
              <div className="mt-4">
                {line.text && (
                  <p className="text-2xl leading-relaxed whitespace-pre-line text-[var(--color-ink-muted)]">
                    {line.text}
                  </p>
                )}
                <p className="mt-3 text-sm text-[var(--color-warn)]">
                  {t(`record.lock.${line.locked.reason}` as TranslationKey)} {line.locked.message}
                </p>
              </div>
            ) : (
              <p
                lang={session.voiceLanguage === "gn" ? "gn" : "es"}
                className="mt-4 text-3xl leading-relaxed font-medium whitespace-pre-line text-[var(--color-ink)] sm:text-4xl"
              >
                {line.text}
              </p>
            )}
            {next && (
              <p className="mt-6 border-t border-[var(--color-border-subtle)] pt-4 text-xl leading-relaxed whitespace-pre-line text-[var(--color-ink)] opacity-40">
                <span className="mr-2 font-mono text-xs">{next.label}</span>
                {next.text}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-[var(--color-ink-muted)]">{t("record.noLines")}</p>
        )}
      </div>

      {/* Recorder */}
      <div className="surface-border surface-card flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
            <span className={VOICE_LABEL}>{t("record.mic.device")}</span>
            <select
              className={VOICE_INPUT}
              value={deviceId}
              disabled={phase === "recording" || phase === "countdown"}
              onChange={(e) => {
                setDeviceId(e.target.value);
                void startMic(e.target.value);
              }}
            >
              {devices.length === 0 && <option value="">{t("record.mic.default")}</option>}
              {devices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `${t("record.mic.device")} ${i + 1}`}
                </option>
              ))}
            </select>
          </label>
          {!micOn ? (
            <button
              type="button"
              className={VOICE_PRIMARY}
              onClick={(e) => {
                blur(e);
                void startMic(deviceId);
              }}
            >
              {t("record.mic.on")}
            </button>
          ) : (
            <button
              type="button"
              className={VOICE_BUTTON}
              disabled={phase === "recording"}
              onClick={(e) => {
                blur(e);
                stopMic();
              }}
            >
              {t("record.mic.off")}
            </button>
          )}
          <label className="flex items-center gap-2 text-xs text-[var(--color-ink)]">
            <input
              type="checkbox"
              checked={countIn}
              onChange={(e) => setCountIn(e.target.checked)}
            />
            {t("record.countIn")}
          </label>
          <label className="flex items-center gap-2 text-xs text-[var(--color-ink)]">
            <input
              type="checkbox"
              checked={autoSelect}
              onChange={(e) => setAutoSelect(e.target.checked)}
            />
            {t("record.autoSelect")}
          </label>
        </div>

        <RecorderMeter
          peak={level.peak}
          rms={level.rms}
          clipped={clipHold}
          label={t("record.mic.level")}
        />

        <div className="flex flex-wrap items-center gap-3">
          {phase === "recording" ? (
            <button
              type="button"
              className={`${VOICE_PRIMARY} bg-[var(--color-danger)]`}
              onClick={(e) => {
                blur(e);
                stop();
              }}
            >
              {t("record.stop")} · {voiceDuration(elapsedMs)}
            </button>
          ) : phase === "countdown" ? (
            <span className="font-mono text-4xl text-[var(--color-accent)]" aria-live="assertive">
              {countdown}
            </span>
          ) : (
            <button
              type="button"
              className={VOICE_PRIMARY}
              disabled={blocked || !micOn || phase === "saving"}
              onClick={(e) => {
                blur(e);
                record();
              }}
            >
              {t(take ? "record.redo" : "record.record")}
            </button>
          )}
          <button
            type="button"
            className={VOICE_BUTTON}
            disabled={phase === "recording" || phase === "saving"}
            onClick={(e) => {
              blur(e);
              goTo(stepLine(lines, index, -1));
            }}
          >
            ← {t("record.prev")}
          </button>
          <button
            type="button"
            className={VOICE_BUTTON}
            disabled={phase === "recording" || phase === "saving"}
            onClick={(e) => {
              blur(e);
              goTo(stepLine(lines, index, 1));
            }}
          >
            {t("record.next")} →
          </button>
          {!micOn && (
            <span className="text-xs text-[var(--color-ink-muted)]">{t("record.mic.hint")}</span>
          )}
        </div>

        {take && (
          <div className="flex flex-col gap-3 border-t border-[var(--color-border-subtle)] pt-3">
            <audio controls src={take.url} className="w-full" />
            {take.analysis ? (
              <p className="text-xs text-[var(--color-ink-muted)]">
                {t("record.analysis", {
                  seconds: (take.analysis.durationMs / 1000).toFixed(1),
                  peak: Number.isFinite(take.analysis.peakDb)
                    ? take.analysis.peakDb.toFixed(1)
                    : "–∞",
                  lead: (take.analysis.leadingSilenceMs / 1000).toFixed(1),
                  tail: (take.analysis.trailingSilenceMs / 1000).toFixed(1),
                })}
              </p>
            ) : (
              <p className="text-xs text-[var(--color-ink-muted)]">{t("record.analysing")}</p>
            )}
            {warnings.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm text-[var(--color-warn)]">
                {warnings.map((w) => (
                  <li key={w}>{t(`record.warn.${w}` as TranslationKey)}</li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className={VOICE_PRIMARY}
                disabled={phase !== "review" || !!session.refusal}
                onClick={(e) => {
                  blur(e);
                  void keep();
                }}
              >
                {phase === "saving" ? t("record.saving") : t("record.keep")}
              </button>
              <button
                type="button"
                className={VOICE_BUTTON}
                disabled={phase !== "review"}
                onClick={(e) => {
                  blur(e);
                  redo();
                }}
              >
                {t("record.redo")}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-[var(--color-danger)]">
            {error}
          </p>
        )}
        {notice && !error && <p className="text-sm text-[var(--color-accent)]">{notice}</p>}
        <p className="text-xs text-[var(--color-ink-muted)]">{t("record.keys")}</p>
      </div>

      {/* All lines */}
      <details className="surface-border surface-card p-4 text-sm">
        <summary className="cursor-pointer font-semibold text-[var(--color-ink)]">
          {t("record.lines.title", { count: lines.length })}
        </summary>
        <ol className="mt-3 flex max-h-96 flex-col gap-1 overflow-y-auto">
          {lines.map((l, i) => (
            <li key={`${l.slot}|${i}`}>
              <button
                type="button"
                onClick={(e) => {
                  blur(e);
                  goTo(i);
                }}
                className={`flex w-full items-baseline gap-2 rounded-[var(--radius-sm)] px-2 py-1 text-left hover:bg-[var(--color-surface-raised)] ${
                  i === index ? "bg-[var(--color-surface-raised)]" : ""
                }`}
              >
                <span className="w-20 shrink-0 font-mono text-xs text-[var(--color-ink-muted)]">
                  {l.label}
                </span>
                <span
                  className={`min-w-0 flex-1 truncate ${
                    l.locked ? "text-[var(--color-ink-muted)]" : "text-[var(--color-ink)]"
                  }`}
                >
                  {l.text || l.locked?.message}
                </span>
                {l.locked ? (
                  <span className={VOICE_BADGE_WARN}>{t("record.line.locked")}</span>
                ) : l.takeCount > 0 ? (
                  <span className={VOICE_BADGE_ON}>{l.takeCount}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ol>
      </details>
    </section>
  );
}
