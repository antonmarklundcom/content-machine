"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { LessonKind } from "@/db/schema";
import { deleteLessonAction } from "@/lib/lessons.actions";
import { translator, type Locale, type TranslationKey } from "@/lib/i18n";
import { ResultMessage } from "./ResultMessage";

export type LessonRowData = {
  id: number;
  text: string;
  kind: LessonKind;
  brandName: string | null;
  videoId: number | null;
  videoTitle: string | null;
  /** YouTube link at the timestamp, when the lesson came from a video. */
  videoUrl: string | null;
  sourceUrl: string | null;
};

/** One saved lesson on `/lessons`: kind, brand, text, where it came from, delete. */
export function LessonRow({ lesson, locale }: { lesson: LessonRowData; locale: Locale }) {
  const t = translator(locale);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <li className="surface-border flex flex-col gap-2 rounded-[var(--radius-md)] bg-[var(--color-surface-raised)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-[var(--color-accent)]/15 px-2 py-0.5 font-medium text-[var(--color-accent)]">
          {t(`lessons.kind.${lesson.kind}` as TranslationKey)}
        </span>
        <span className="text-[var(--color-ink-muted)]">
          {lesson.brandName ?? t("lessons.filter.noBrand")}
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(t("lessons.deleteConfirm"))) return;
            startTransition(async () => {
              setError(null);
              const res = await deleteLessonAction(lesson.id).catch(() => null);
              if (res?.ok) router.refresh();
              else setError(res?.error ?? t("lessons.failed"));
            });
          }}
          className="ml-auto text-[var(--color-ink-muted)] hover:text-[var(--color-danger)] disabled:opacity-50"
        >
          {t("lessons.delete")}
        </button>
      </div>
      <p className="text-sm whitespace-pre-line text-[var(--color-ink)]">{lesson.text}</p>
      {(lesson.videoUrl || lesson.sourceUrl) && (
        <p className="flex flex-wrap gap-3 text-xs text-[var(--color-ink-muted)]">
          {lesson.videoUrl && (
            <a
              href={lesson.videoUrl}
              target="_blank"
              rel="noreferrer"
              className="hover:text-[var(--color-accent)]"
            >
              {t("lessons.fromVideo", { title: lesson.videoTitle ?? "YouTube" })}
            </a>
          )}
          {lesson.sourceUrl && /^https?:\/\//i.test(lesson.sourceUrl) && (
            <a
              href={lesson.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="break-all hover:text-[var(--color-accent)]"
            >
              {lesson.sourceUrl}
            </a>
          )}
        </p>
      )}
      {error && <ResultMessage tone="error">{error}</ResultMessage>}
    </li>
  );
}
