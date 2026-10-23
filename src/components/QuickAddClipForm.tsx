"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { postClientJson } from "@/lib/client-json";
import { useTranslator } from "@/lib/i18n/client";
import { translator, type Locale } from "@/lib/i18n";
import { ResultMessage } from "./ResultMessage";

const FIELD =
  "surface-border w-full rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

/**
 * The fallback capture path (PLAN.md §6.S3.4): paste a URL and an optional
 * note, same body `POST /api/clips` already accepts from a share sheet. This
 * is the browser's own session cookie, not the Bearer path — the same route,
 * a different caller.
 */
export function QuickAddClipForm({ locale }: { locale?: Locale } = {}) {
  const fallback = useTranslator();
  const t = locale ? translator(locale) : fallback;
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [learning, setLearning] = useState(true);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [expired, setExpired] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      setResult(null);
      setExpired(false);
      try {
        const response = await postClientJson("/api/clips", {
          url,
          note: note || undefined,
          purpose: learning ? "learn" : undefined,
        });
        const clip = response.data.clip as { id?: unknown } | undefined;
        if (!response.ok || !Number.isInteger(clip?.id) || Number(clip?.id) <= 0) {
          setExpired(response.expired);
          setResult({
            tone: "error",
            text: response.expired
              ? t("capture.error.expired")
              : typeof response.data.error === "string"
                ? response.data.error
                : t("capture.error.receipt"),
          });
          return;
        }
        setResult({ tone: "success", text: t("inbox.quickAdd.saved") });
        setUrl("");
        setNote("");
        router.refresh();
      } catch {
        setResult({ tone: "error", text: t("capture.error.network") });
      }
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-[var(--color-ink-muted)]">
          {t("inbox.quickAdd.urlLabel")}
        </span>
        <input
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t("inbox.quickAdd.urlPlaceholder")}
          className={FIELD}
          inputMode="url"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-[var(--color-ink-muted)]">
          {t("inbox.quickAdd.noteLabel")}
        </span>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("inbox.quickAdd.notePlaceholder")}
          className={FIELD}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={learning} onChange={(e) => setLearning(e.target.checked)} />
        {t("capture.purpose.learn")}
      </label>
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      >
        {pending ? t("inbox.quickAdd.saving") : t("inbox.quickAdd.submit")}
      </button>
      {result && <ResultMessage tone={result.tone}>{result.text}</ResultMessage>}
      {expired && (
        <a
          href="/youtube/login"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-[var(--color-accent)] underline"
        >
          {t("capture.signInRetry")}
        </a>
      )}
    </form>
  );
}
