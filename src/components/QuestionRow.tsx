"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { AudienceQuestionStatus } from "@/db/schema";
import { useTranslator } from "@/lib/i18n/client";
import { setQuestionStatusAction, writeScriptFromQuestionAction } from "@/lib/report.actions";
import { ResultMessage } from "./ResultMessage";
import { STUDIO_BUTTON } from "./StudioStyles";

export type QuestionRowData = {
  id: number;
  question: string;
  askCount: number;
  examples: string[];
  videoCount: number;
  status: AudienceQuestionStatus;
};

/**
 * One mined question (build 2b, idea 2): its count, the viewers' own words,
 * and what to do with it. "Write script" marks it used and opens the brief
 * with the question as the topic.
 */
export function QuestionRow({ q }: { q: QuestionRowData }) {
  const t = useTranslator();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const setStatus = (status: AudienceQuestionStatus) =>
    startTransition(async () => {
      setError(null);
      const res = await setQuestionStatusAction(q.id, status);
      if (res.ok) router.refresh();
      else setError(res.error);
    });

  const writeScript = () =>
    startTransition(async () => {
      setError(null);
      const res = await writeScriptFromQuestionAction(q.id);
      if (res.ok) router.push(res.href);
      else setError(res.error);
    });

  return (
    <li className="surface-border surface-card flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-medium leading-snug text-[var(--color-ink)]">{q.question}</h3>
        <span className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-2 py-0.5 text-xs font-semibold text-[var(--color-accent-ink)]">
          {t("questions.askCount", { count: q.askCount })}
        </span>
      </div>
      <p className="text-xs text-[var(--color-ink-muted)]">
        {t(`questions.status.${q.status}`)} · {t("questions.videos", { count: q.videoCount })}
      </p>
      {q.examples.length > 0 && (
        <details className="text-sm text-[var(--color-ink-muted)]">
          <summary className="cursor-pointer text-xs">{t("questions.examples")}</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {q.examples.map((e, i) => (
              <li
                key={i}
                className="border-l-2 border-[var(--color-border-subtle)] pl-3 leading-relaxed"
              >
                {e}
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={STUDIO_BUTTON} disabled={pending} onClick={writeScript}>
          {t("questions.writeScript")}
        </button>
        {q.status === "dismissed" ? (
          <button
            type="button"
            className={STUDIO_BUTTON}
            disabled={pending}
            onClick={() => setStatus("new")}
          >
            {t("questions.restore")}
          </button>
        ) : (
          <button
            type="button"
            className={STUDIO_BUTTON}
            disabled={pending}
            onClick={() => setStatus("dismissed")}
          >
            {t("questions.dismiss")}
          </button>
        )}
      </div>
      {error && <ResultMessage tone="error">{error}</ResultMessage>}
    </li>
  );
}
