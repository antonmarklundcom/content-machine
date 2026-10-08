import type { CaptionStatus } from "@/db/schema";
import { translator, type Locale, type TranslationKey } from "@/lib/i18n";

/**
 * Four distinct states, four distinct looks (docs/HANDOFF-SONNET.md §2) —
 * collapsing `none` and `failed` into one badge hides the distinction the
 * caption pipeline's retry logic depends on.
 */
const KEY: Record<CaptionStatus, TranslationKey> = {
  unknown: "caption.unknown",
  available: "caption.available",
  none: "caption.none",
  failed: "caption.failed",
};

const CLASS: Record<CaptionStatus, string> = {
  unknown: "bg-[var(--color-surface)] text-[var(--color-ink-muted)]",
  available: "bg-[var(--color-accent-ink)] text-[var(--color-accent)]",
  none: "bg-[var(--color-surface)] text-[var(--color-ink-muted)]",
  failed: "bg-[color-mix(in_srgb,var(--color-danger)_18%,transparent)] text-[var(--color-danger)]",
};

export function CaptionBadge({ status, locale }: { status: CaptionStatus; locale: Locale }) {
  return (
    <span
      className={`surface-border inline-flex w-fit items-center rounded-[var(--radius-sm)] px-2 py-0.5 text-xs font-medium ${CLASS[status]}`}
    >
      {translator(locale)(KEY[status])}
    </span>
  );
}
