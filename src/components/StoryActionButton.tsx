"use client";

import { useState, useTransition } from "react";
import { translator, type Locale, type TranslationKey } from "@/lib/i18n";
import type { StoryActionResult } from "@/lib/stories/result";
import { StoryResult } from "./StoryResult";

const TONES = {
  primary: "bg-[var(--color-accent)] text-[var(--color-accent-ink)] hover:opacity-90",
  quiet: "surface-border text-[var(--color-ink)] hover:border-[var(--color-accent)]",
  danger: "border border-[var(--color-danger)] text-[var(--color-danger)] hover:opacity-90",
} as const;

/** One click → one bound server action (select a take, approve text, …), its result inline. */
export function StoryActionButton({
  action,
  label,
  labelVars,
  locale,
  tone = "quiet",
}: {
  action: () => Promise<StoryActionResult>;
  label: TranslationKey;
  labelVars?: Record<string, string | number>;
  locale: Locale;
  tone?: keyof typeof TONES;
}) {
  const t = translator(locale);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<StoryActionResult | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setResult(await action()))}
        className={`rounded-[var(--radius-sm)] px-2.5 py-1 text-xs font-medium transition-opacity disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] ${TONES[tone]}`}
      >
        {pending ? t("stories.working") : t(label, labelVars)}
      </button>
      {result && !result.ok && <StoryResult result={result} locale={locale} />}
      {result?.ok && result.lines?.length ? <StoryResult result={result} locale={locale} /> : null}
    </span>
  );
}
