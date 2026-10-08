import type { AnalysisState } from "@/lib/analysis/state";
import { translator, type Locale, type TranslationKey } from "@/lib/i18n";

const KEY: Record<Exclude<AnalysisState, "unanalysable">, TranslationKey> = {
  analysed: "analysisState.analysed",
  failed: "analysisState.failed",
  pending: "analysisState.pending",
};

const CLASS: Record<Exclude<AnalysisState, "unanalysable">, string> = {
  analysed: "bg-[var(--color-accent-ink)] text-[var(--color-accent)]",
  failed: "bg-[color-mix(in_srgb,var(--color-danger)_18%,transparent)] text-[var(--color-danger)]",
  pending: "bg-[var(--color-surface)] text-[var(--color-ink-muted)]",
};

/**
 * Sits next to the caption badge. `unanalysable` renders nothing — the caption
 * badge already says why, and two muted badges saying the same thing is noise.
 */
export function AnalysisBadge({ state, locale }: { state: AnalysisState; locale: Locale }) {
  if (state === "unanalysable") return null;
  return (
    <span
      className={`surface-border inline-flex w-fit items-center rounded-[var(--radius-sm)] px-2 py-0.5 text-xs font-medium ${CLASS[state]}`}
    >
      {translator(locale)(KEY[state])}
    </span>
  );
}
