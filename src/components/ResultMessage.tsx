"use client";

import { useTranslator } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n";

export type ResultTone = "success" | "info" | "error";

const CLASS: Record<ResultTone, string> = {
  success: "border-[var(--color-accent)] text-[var(--color-accent)]",
  info: "border-[var(--color-border-subtle)] text-[var(--color-ink)]",
  error: "border-[var(--color-danger)] text-[var(--color-danger)]",
};

const PREFIX: Record<ResultTone, TranslationKey> = {
  success: "result.success",
  info: "result.info",
  error: "result.error",
};

/**
 * One shape per outcome (PR-21). Colour alone does not carry the distinction \u2014
 * the prefix does, and aria-live makes the result reach a screen reader at all,
 * since it appears without any focus change.
 *
 * Reads the locale from the cookie rather than a prop: this renders inside
 * several client forms, and threading a locale through each of them to label
 * one word is not worth the prop.
 */
export function ResultMessage({ tone, children }: { tone: ResultTone; children: React.ReactNode }) {
  const t = useTranslator();

  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      aria-live="polite"
      className={`rounded-[var(--radius-sm)] border-l-2 bg-[var(--color-surface)] px-3 py-2 text-sm ${CLASS[tone]}`}
    >
      <span className="font-medium">{t(PREFIX[tone])}: </span>
      {children}
    </p>
  );
}
