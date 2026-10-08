"use client";

import { useState, useTransition } from "react";
import { LESSON_KINDS, type LessonKind } from "@/db/schema";
import { lessonBrandOptionsAction, saveLessonAction } from "@/lib/lessons.actions";
import { useTranslator } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n";
import { ResultMessage, type ResultTone } from "./ResultMessage";

const FIELD =
  "surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * Save a key point (or anything else) from a video as a lesson (PLAN.md §6.S11.1).
 * Exported only — S9 mounts it on the video page. Opens an inline form with the
 * text prefilled; brands are fetched on first open, so the host page needs to
 * load nothing extra.
 */
export function SaveLessonButton({
  videoId,
  text = "",
  timestampSec,
  defaultBrandId,
}: {
  videoId: number;
  text?: string;
  timestampSec?: number | null;
  defaultBrandId?: string | null;
}) {
  const t = useTranslator();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(text);
  const [kind, setKind] = useState<LessonKind>("lesson");
  const [brandId, setBrandId] = useState(defaultBrandId ?? "");
  const [brands, setBrands] = useState<{ id: string; name: string }[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ tone: ResultTone; text: string } | null>(null);

  function openForm() {
    setOpen(true);
    setResult(null);
    setDraft(text);
    if (brands === null) {
      lessonBrandOptionsAction()
        .then(setBrands)
        .catch(() => setBrands([]));
    }
  }

  if (!open) {
    return (
      <div className="flex flex-col items-start gap-2">
        <button
          type="button"
          onClick={openForm}
          className="text-xs font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
        >
          {t("lessons.save.open")}
        </button>
        {result && <ResultMessage tone={result.tone}>{result.text}</ResultMessage>}
      </div>
    );
  }

  return (
    <form
      className="surface-border flex flex-col gap-3 rounded-[var(--radius-md)] bg-[var(--color-surface-raised)] p-3"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          setResult(null);
          const res = await saveLessonAction({
            text: draft,
            kind,
            brandId: brandId || null,
            videoId,
            timestampSec: timestampSec ?? null,
          }).catch(() => null);
          if (res?.ok) {
            setOpen(false);
            setResult({ tone: "success", text: t("lessons.save.saved") });
          } else {
            setResult({ tone: "error", text: res?.error ?? t("lessons.failed") });
          }
        });
      }}
    >
      <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
        {t("lessons.save.text")}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          required
          className={FIELD}
        />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
          {t("lessons.filter.kind")}
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as LessonKind)}
            className={FIELD}
          >
            {LESSON_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`lessons.kind.${k}` as TranslationKey)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--color-ink-muted)]">
          {t("lessons.filter.brand")}
          <select value={brandId} onChange={(e) => setBrandId(e.target.value)} className={FIELD}>
            <option value="">{t("lessons.filter.noBrand")}</option>
            {/* The default brand shows before the list arrives, so the select never drops it. */}
            {brandId && !brands?.some((b) => b.id === brandId) && (
              <option value={brandId}>{brandId}</option>
            )}
            {brands?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        {typeof timestampSec === "number" && (
          <span className="py-2 text-xs text-[var(--color-ink-muted)]">
            {t("lessons.save.at", { time: clock(timestampSec) })}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || !draft.trim()}
          className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] hover:opacity-90 disabled:opacity-50"
        >
          {pending ? t("lessons.save.saving") : t("lessons.save.submit")}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
        >
          {t("lessons.save.cancel")}
        </button>
      </div>
      {result && <ResultMessage tone={result.tone}>{result.text}</ResultMessage>}
    </form>
  );
}
