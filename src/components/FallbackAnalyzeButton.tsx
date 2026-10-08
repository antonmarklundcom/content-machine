"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { analyzeWithoutCaptionsAction, fallbackEstimateAction } from "@/lib/lessons.actions";
import { useTranslator } from "@/lib/i18n/client";
import { ResultMessage, type ResultTone } from "./ResultMessage";

/**
 * The no-captions fallback (PLAN.md §1.35, §6.S11.1): for a video with no
 * transcript. First click fetches the estimate; the second, on "Confirm",
 * spends. Owner only — rendered as nothing for anyone else (the actions check
 * again). Exported only; S9 mounts it on the video page.
 */
export function FallbackAnalyzeButton({ videoId, isOwner }: { videoId: number; isOwner: boolean }) {
  const t = useTranslator();
  const router = useRouter();
  const [estimate, setEstimate] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ tone: ResultTone; text: string } | null>(null);

  if (!isOwner) return null;

  const primary =
    "rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 disabled:opacity-50";
  const secondary =
    "surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-4 py-2 text-sm font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-accent)] disabled:opacity-50";

  return (
    <div className="flex flex-col items-start gap-2">
      {estimate === null ? (
        <button
          type="button"
          disabled={pending}
          className={secondary}
          onClick={() =>
            startTransition(async () => {
              setResult(null);
              const res = await fallbackEstimateAction(videoId).catch(() => null);
              if (res?.ok) setEstimate(res.estimate);
              else setResult({ tone: "error", text: res?.error ?? t("lessons.failed") });
            })
          }
        >
          {pending ? t("fallback.estimating") : t("fallback.open")}
        </button>
      ) : (
        <>
          <p className="text-sm text-[var(--color-ink-muted)]">
            {t("fallback.explain", { cost: estimate })}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={pending}
              className={primary}
              onClick={() =>
                startTransition(async () => {
                  setResult(null);
                  const res = await analyzeWithoutCaptionsAction(videoId).catch(() => null);
                  setEstimate(null);
                  if (res?.ok) {
                    setResult({ tone: "success", text: res.message });
                    router.refresh();
                  } else {
                    setResult({ tone: "error", text: res?.error ?? t("lessons.failed") });
                  }
                })
              }
            >
              {pending ? t("fallback.running") : t("fallback.confirm", { cost: estimate })}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setEstimate(null)}
              className="text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
            >
              {t("fallback.cancel")}
            </button>
          </div>
        </>
      )}
      {result && <ResultMessage tone={result.tone}>{result.text}</ResultMessage>}
    </div>
  );
}
