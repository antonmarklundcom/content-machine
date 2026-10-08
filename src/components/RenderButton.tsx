"use client";

import { useEffect, useState, useTransition } from "react";
import { listMusicAction, startRenderAction } from "@/lib/video.actions";
import type { MusicTrack } from "@/lib/media/music";
import { MUSIC_DB_CHOICES, MUSIC_DB_DEFAULT } from "@/lib/media/music-levels";
import type { RenderOwnerKind, VideoFormat } from "@/lib/video/contract";
import { formatDuration, isActive, type RenderView } from "@/lib/video/view";
import { useTranslator } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n";
import { ResultMessage } from "./ResultMessage";

const POLL_MS = 3000;

const BUTTON =
  "surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-4 py-2 text-sm font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-accent)] disabled:opacity-50";
const SELECT =
  "surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-ink)]";

/**
 * "Render video" for any page that owns something renderable (build 4 §3.B):
 * pick a language and a format, start the render (the server action returns
 * at once), then poll `/api/video/renders/<id>` until it is done or failed.
 */
export function RenderButton({
  ownerKind,
  ownerRef,
  languages,
  formats = ["16x9", "9x16", "1x1"],
  defaultLanguage,
  musicTracks,
}: {
  ownerKind: RenderOwnerKind;
  ownerRef: string;
  languages: string[];
  formats?: VideoFormat[];
  defaultLanguage?: string;
  /** Music beds to offer; when omitted the button asks the server once. */
  musicTracks?: MusicTrack[];
}) {
  const t = useTranslator();
  const [language, setLanguage] = useState(defaultLanguage ?? languages[0] ?? "");
  const [format, setFormat] = useState<VideoFormat>(formats[0] ?? "16x9");
  const [burn, setBurn] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [renderId, setRenderId] = useState<number | null>(null);
  const [view, setView] = useState<RenderView | null>(null);
  const [tracks, setTracks] = useState<MusicTrack[]>(musicTracks ?? []);
  const [music, setMusic] = useState("");
  const [musicDb, setMusicDb] = useState<number>(MUSIC_DB_DEFAULT);

  useEffect(() => {
    if (musicTracks) return;
    let stopped = false;
    listMusicAction()
      .then((list) => {
        if (!stopped) setTracks(list);
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, [musicTracks]);

  useEffect(() => {
    if (renderId == null) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const res = await fetch(`/api/video/renders/${renderId}`, { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as RenderView;
          if (stopped) return;
          setView(next);
          if (!isActive(next.status)) return;
        }
      } catch {
        // A dropped poll is retried on the next tick.
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [renderId]);

  function submit() {
    setError(null);
    setView(null);
    start(async () => {
      const result = await startRenderAction({
        ownerKind,
        ownerRef,
        language,
        format,
        burnCaptions: burn,
        musicPath: music || null,
        musicDb,
      });
      if (result.ok) setRenderId(result.renderId);
      else setError(result.error);
    });
  }

  const busy = pending || (view ? isActive(view.status) : renderId != null && !view);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
          {t("videoRender.button.language")}
          <select className={SELECT} value={language} onChange={(e) => setLanguage(e.target.value)}>
            {languages.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
          {t("videoRender.button.format")}
          <select
            className={SELECT}
            value={format}
            onChange={(e) => setFormat(e.target.value as VideoFormat)}
          >
            {formats.map((f) => (
              <option key={f} value={f}>
                {f.replace("x", ":")}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 py-1.5 text-sm text-[var(--color-ink)]">
          <input type="checkbox" checked={burn} onChange={(e) => setBurn(e.target.checked)} />
          {t("videoRender.button.burn")}
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
          {t("videoRender.button.music")}
          <select className={SELECT} value={music} onChange={(e) => setMusic(e.target.value)}>
            <option value="">{t("videoRender.button.musicNone")}</option>
            {tracks.map((m) => (
              <option key={m.path} value={m.path}>
                {m.name}
                {m.durationSec != null ? ` (${formatDuration(m.durationSec * 1000)})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
          {t("videoRender.button.musicDb")}
          <select
            className={SELECT}
            value={musicDb}
            disabled={!music}
            onChange={(e) => setMusicDb(Number(e.target.value))}
          >
            {MUSIC_DB_CHOICES.map((d) => (
              <option key={d} value={d}>
                {d} dB
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={BUTTON} onClick={submit} disabled={busy || !language}>
          {pending ? t("videoRender.button.starting") : t("videoRender.button.start")}
        </button>
        <a href="/video" className="py-2 text-sm text-[var(--color-accent)] hover:underline">
          {t("videoRender.button.all")}
        </a>
      </div>

      {error && <ResultMessage tone="error">{error}</ResultMessage>}
      {view && view.status === "done" && (
        <ResultMessage tone="success">
          {t("videoRender.button.done", { id: view.id, duration: formatDuration(view.durationMs) })}{" "}
          {view.videoUrl && <FileLink href={view.videoUrl} label={t("videoRender.file.mp4")} />}
          {view.srtUrl && <FileLink href={view.srtUrl} label={t("videoRender.file.srt")} />}
          {view.vttUrl && <FileLink href={view.vttUrl} label={t("videoRender.file.vtt")} />}
        </ResultMessage>
      )}
      {view && view.status === "failed" && (
        <ResultMessage tone="error">
          {t("videoRender.button.failed", {
            id: view.id,
            error: view.error ?? t("videoRender.noError"),
          })}
        </ResultMessage>
      )}
      {renderId != null && (!view || isActive(view.status)) && (
        <ResultMessage tone="info">
          {t("videoRender.button.progress", {
            id: renderId,
            status: t(`videoRender.status.${view?.status ?? "queued"}` as TranslationKey),
          })}
        </ResultMessage>
      )}
    </div>
  );
}

function FileLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="mr-2 underline" target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}
