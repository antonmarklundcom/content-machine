"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { analyzeVideoAction } from "@/lib/analyze.actions";
import { translator, type Locale } from "@/lib/i18n";
import { ResultMessage, type ResultTone } from "./ResultMessage";

/**
 * "Analyse" on an outlier row: the existing action, unchanged (spend cap, owner
 * gate and all). No estimate on the label, unlike `AnalyzeButton` — the board's
 * query does not read transcripts, and the action reports the real cost after.
 */
export function ResearchAnalyzeButton({ videoId, locale }: { videoId: number; locale: Locale }) {
  const t = translator(locale);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ tone: ResultTone; text: string } | null>(null);

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setResult(null);
            const res = await analyzeVideoAction(videoId);
            setResult({
              tone: res.ok ? "success" : "error",
              text: res.ok ? res.message : res.error,
            });
            if (res.ok) router.refresh();
          })
        }
        className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      >
        {pending ? t("research.analysing") : t("research.analyse")}
      </button>
      {result && <ResultMessage tone={result.tone}>{result.text}</ResultMessage>}
    </div>
  );
}
