"use client";

import { useState } from "react";
import { useTranslator } from "@/lib/i18n/client";

/**
 * Copy an arbitrary blob to the clipboard. The failed-analysis raw response is
 * the case that needs it: it is the only record of why a paid call failed, and
 * selecting several hundred lines out of a scrolling <pre> by hand is how that
 * record gets lost.
 */
export function CopyTextButton({
  text,
  label,
  className = "surface-border rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const t = useTranslator();
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      {copied ? t("video.copied") : label}
    </button>
  );
}
