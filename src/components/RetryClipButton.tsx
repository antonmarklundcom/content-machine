"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ResultMessage } from "./ResultMessage";
import type { ClipActionResult } from "@/lib/clips.actions";

const BUTTON =
  "surface-border rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] hover:border-[var(--color-accent)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";

/**
 * Re-runs `processYouTubeClip` on a failed clip (KNOWN-ISSUES.md: "a clip can
 * get stuck in ingesting" — the manual retry that entry calls for). A client
 * component rather than a plain form because the action can spend money and
 * take a while (captions + analysis), so it needs a pending state and a place
 * to show a failure without losing the row.
 */
export function RetryClipButton({
  clipId,
  action,
  label,
  retryingLabel,
}: {
  clipId: number;
  action: (clipId: number) => Promise<ClipActionResult>;
  label: string;
  retryingLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        className={BUTTON}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await action(clipId);
            if (!result.ok) setError(result.error);
            router.refresh();
          })
        }
      >
        {pending ? retryingLabel : label}
      </button>
      {error && <ResultMessage tone="error">{error}</ResultMessage>}
    </div>
  );
}
