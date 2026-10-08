"use client";

import { translator, type Locale } from "@/lib/i18n";
import type { StoryActionResult } from "@/lib/stories/result";
import { ResultMessage } from "./ResultMessage";

/** A story studio result: the message in the viewer's language, then the English detail lines. */
export function StoryResult({
  result,
  locale,
}: {
  result: StoryActionResult | null;
  locale: Locale;
}) {
  if (!result) return null;
  const t = translator(locale);
  const lines = result.lines?.filter(Boolean) ?? [];
  return (
    <div className="flex flex-col gap-1">
      {result.ok ? (
        <ResultMessage tone="success">{t(result.message, result.vars)}</ResultMessage>
      ) : (
        <ResultMessage tone="error">
          {t(result.error)}
          {result.detail ? ` — ${result.detail}` : ""}
        </ResultMessage>
      )}
      {lines.length > 0 && (
        <pre className="max-h-60 overflow-auto rounded-[var(--radius-sm)] bg-[var(--color-surface)] px-3 py-2 text-xs whitespace-pre-wrap text-[var(--color-ink-muted)]">
          {lines.join("\n")}
        </pre>
      )}
    </div>
  );
}
