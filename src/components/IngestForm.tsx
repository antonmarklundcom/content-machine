"use client";

import { useActionState, useState } from "react";
import { submitIngest, type IngestFormResult } from "@/lib/ingest.actions";
import { createNdjsonParser } from "@/lib/ndjson";
import { translator, type Locale, type Translator } from "@/lib/i18n";
import { ResultMessage, type ResultTone } from "./ResultMessage";
import { parseYouTubeUrl } from "@/lib/youtube/url";

const initialState: IngestFormResult | null = null;

type WireProgress =
  | { phase: "resolved"; description: string }
  | { phase: "listed"; count: number }
  | { phase: "stored"; index: number; total: number; title: string }
  | { phase: "captions"; index: number; total: number; title: string; outcome: string };

type Line =
  | { type: "progress"; event: WireProgress }
  | { type: "done"; message: string }
  | { type: "error"; error: string };

function describe(t: Translator, event: WireProgress): string {
  switch (event.phase) {
    case "resolved":
      return t("ingest.progress.resolved", { description: event.description });
    case "listed":
      return t("ingest.progress.listed", { count: event.count });
    case "stored":
      return t("ingest.progress.stored", {
        index: event.index + 1,
        total: event.total,
        title: event.title,
      });
    case "captions":
      return t("ingest.progress.captions", {
        index: event.index + 1,
        total: event.total,
        outcome: event.outcome,
        title: event.title,
      });
  }
}

/**
 * Two submit paths, because the work is genuinely different (PR-20).
 *
 * A single video is ingested *and analysed*, which needs the spend check in the
 * server action. A playlist or channel walks up to 25 videos with paced caption
 * fetches — minutes of work — so it streams progress from /api/ingest instead
 * of leaving a frozen "Working…" on screen with no way to tell slow from hung.
 */
export function IngestForm({ locale }: { locale: Locale }) {
  const t = translator(locale);
  const [state, formAction, pending] = useActionState(submitIngest, initialState);
  const [showTranscript, setShowTranscript] = useState(false);

  const [streaming, setStreaming] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [streamResult, setStreamResult] = useState<{ tone: ResultTone; text: string } | null>(null);

  async function runStreamingIngest(url: string) {
    setStreaming(true);
    setProgress([]);
    setStreamResult(null);

    try {
      const response = await fetch("/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.error ?? `${t("ingest.failed")} (${response.status})`);
      }

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      const parse = createNdjsonParser<Line>();

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const line of parse(value)) {
          if (line.type === "progress") {
            setProgress((prev) => [...prev, describe(t, line.event)]);
          } else if (line.type === "done") {
            // Bulk ingest analyses nothing, so this is never a "success" — the
            // videos still need analysing from the feed.
            setStreamResult({ tone: "info", text: line.message });
          } else {
            setStreamResult({ tone: "error", text: line.error });
          }
        }
      }
    } catch (err) {
      setStreamResult({
        tone: "error",
        text: err instanceof Error ? err.message : t("ingest.failed"),
      });
    } finally {
      setStreaming(false);
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const url = String(new FormData(form).get("url") ?? "").trim();
    const ref = parseYouTubeUrl(url);
    // Anything that is not a bulk ref — including unparseable input, so the
    // server action stays the single source of validation messages — falls
    // through to the normal action.
    if (!ref || ref.kind === "video") return;

    event.preventDefault();
    await runStreamingIngest(url);
  }

  const busy = pending || streaming;
  const result =
    streamResult ??
    (state ? { tone: state.tone, text: state.ok ? state.message : state.error } : null);

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-[var(--color-ink-muted)]">{t("ingest.urlLabel")}</span>
        <input
          type="text"
          name="url"
          required
          placeholder={t("ingest.urlPlaceholder")}
          className="surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        />
      </label>

      <button
        type="button"
        onClick={() => setShowTranscript((v) => !v)}
        className="w-fit rounded-[var(--radius-sm)] text-xs text-[var(--color-accent)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      >
        {t(showTranscript ? "ingest.hideTranscript" : "ingest.showTranscript")}
      </button>

      {showTranscript && (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-[var(--color-ink-muted)]">
            {t("ingest.transcriptLabel")}
          </span>
          <textarea
            name="transcript"
            rows={8}
            placeholder={t("ingest.transcriptPlaceholder")}
            className="surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          />
        </label>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-fit rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy ? t("ingest.working") : t("ingest.submit")}
      </button>

      {progress.length > 0 && (
        <ol
          aria-live="polite"
          className="surface-border max-h-56 overflow-auto rounded-[var(--radius-sm)] bg-[var(--color-surface)] p-3 text-xs text-[var(--color-ink-muted)]"
        >
          {progress.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ol>
      )}

      {result && <ResultMessage tone={result.tone}>{result.text}</ResultMessage>}
    </form>
  );
}
