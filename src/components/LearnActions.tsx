"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useTranslator } from "@/lib/i18n/client";
import {
  deleteLearnAction,
  setLearnCommittedAction,
  setLearnImplementedAction,
  summariseLearnAction,
  type LearnActionResult,
} from "@/lib/learn.actions";
import { ResultMessage } from "./ResultMessage";

const BUTTON =
  "surface-border rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] hover:border-[var(--color-accent)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

/**
 * A learn card's buttons. Client-side because the summary can take a while
 * and spend money, so it needs a pending state and a place to show a refusal
 * (the cap, nothing to summarise) without losing the card.
 */
export function LearnActions({
  clipId,
  summarised,
  implemented,
  committed,
}: {
  clipId: number;
  summarised: boolean;
  implemented: boolean;
  committed: boolean;
}) {
  const t = useTranslator();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<LearnActionResult | null>(null);

  const run = (action: () => Promise<LearnActionResult>) =>
    startTransition(async () => {
      setResult(null);
      const r = await action();
      setResult(r.ok && !r.message ? null : r);
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          className={BUTTON}
          onClick={() => run(() => summariseLearnAction(clipId))}
        >
          {pending
            ? t("learn.action.working")
            : t(summarised ? "learn.action.rerun" : "learn.action.summarise")}
        </button>
        <button
          type="button"
          disabled={pending}
          className={BUTTON}
          onClick={() => run(() => setLearnImplementedAction(clipId, !implemented))}
        >
          {t(implemented ? "learn.action.undoImplement" : "learn.action.implement")}
        </button>
        {!implemented && (
          <button
            type="button"
            disabled={pending}
            className={BUTTON}
            onClick={() => run(() => setLearnCommittedAction(clipId, !committed))}
          >
            {t(committed ? "learn.action.uncommit" : "learn.action.commit")}
          </button>
        )}
        <button
          type="button"
          disabled={pending}
          className={`${BUTTON} text-[var(--color-danger)]`}
          onClick={() => {
            if (window.confirm(t("learn.action.confirmDelete"))) {
              run(() => deleteLearnAction(clipId));
            }
          }}
        >
          {t("learn.action.delete")}
        </button>
      </div>
      {result && (
        <ResultMessage tone={result.ok ? "success" : "error"}>
          {result.ok ? result.message : result.error}
        </ResultMessage>
      )}
    </div>
  );
}
