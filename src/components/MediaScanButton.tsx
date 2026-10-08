"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { scanNowAction, type ScanNowResult } from "@/lib/media.actions";
import { useTranslator } from "@/lib/i18n/client";
import { ResultMessage } from "./ResultMessage";

/** "Scan now" (PLAN.md §6.S14): O10's `scanMediaRoot` on a click, then a refresh of the grid. */
export function MediaScanButton({ disabled }: { disabled?: boolean }) {
  const t = useTranslator();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ScanNowResult | null>(null);

  function scan() {
    start(async () => {
      const next = await scanNowAction();
      setResult(next);
      if (next.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={scan}
        disabled={pending || disabled}
        className="surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-4 py-2 text-sm font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-accent)] disabled:opacity-50"
      >
        {pending ? t("media.scan.running") : t("media.scan.button")}
      </button>
      {result &&
        (result.ok ? (
          <ResultMessage tone={result.errors ? "info" : "success"}>
            {t("media.scan.result", {
              created: result.created,
              existing: result.existing,
              updated: result.updated,
              skipped: result.skipped,
            })}
            {result.errors ? ` ${t("media.scan.errors", { n: result.errors })}` : ""}
          </ResultMessage>
        ) : (
          <ResultMessage tone="error">{result.error}</ResultMessage>
        ))}
    </div>
  );
}
