"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslator } from "@/lib/i18n/client";
import { ResultMessage } from "./ResultMessage";

const FIELD =
  "surface-border w-full rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

/**
 * The fallback capture path (PLAN.md §6.S3.4): paste a URL and an optional
 * note, same body `POST /api/clips` already accepts from a share sheet. This
 * is the browser's own session cookie, not the Bearer path — the same route,
 * a different caller.
 */
export function QuickAddClipForm() {
  const t = useTranslator();
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      setResult(null);
      const res = await fetch("/api/clips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, note: note || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ tone: "error", text: body.error ?? `Request failed (${res.status})` });
        return;
      }
      setResult({ tone: "success", text: t("inbox.quickAdd.saved") });
      setUrl("");
      setNote("");
      router.refresh();
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
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      >
        {pending ? t("inbox.quickAdd.saving") : t("inbox.quickAdd.submit")}
      </button>
      {result && <ResultMessage tone={result.tone}>{result.text}</ResultMessage>}
    </form>
  );
}
