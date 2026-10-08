"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { analyzeVideoAction } from "@/lib/analyze.actions";
import { translator, type Locale, type TranslationKey } from "@/lib/i18n";
import { ResultMessage, type ResultTone } from "./ResultMessage";

/**
 * One button, three uses: analyse a pending video, retry a failed one, and
 * re-run a successful one on a stronger model. The estimate is rendered by the
 * server (it needs the transcript\u2019s word count) and passed in already formatted.
 */
export function AnalyzeButton({
  videoId,
  labelKey,
  estimate,
  locale,
  model,
  force = false,
  variant = "primary",
}: {
  videoId: number;
  labelKey: TranslationKey;
  estimate: string;
  locale: Locale;
  model?: string;
  force?: boolean;
  variant?: "primary" | "secondary";
}) {
  const t = translator(locale);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ tone: ResultTone; text: string } | null>(null);

  const className =
    variant === "primary"
      ? "rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      : "surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-4 py-2 text-sm font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-accent)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setResult(null);
            const res = await analyzeVideoAction(videoId, { model, force });
            setResult({
              tone: res.ok ? "success" : "error",
              text: res.ok ? res.message : res.error,
            });
            // revalidatePath marks the cache stale; this is what actually
            // re-renders the page the user is looking at.
            if (res.ok) router.refresh();
          })
        }
        className={className}
      >
        {pending ? t("video.analysing") : `${t(labelKey)} \u00b7 ~${estimate}`}
      </button>
      {result && <ResultMessage tone={result.tone}>{result.text}</ResultMessage>}
    </div>
  );
}
