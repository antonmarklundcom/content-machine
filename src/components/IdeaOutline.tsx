"use client";

import { useState, useTransition } from "react";
import type { OutlinePayload } from "@/lib/analysis/contract";
import { useTranslator } from "@/lib/i18n/client";
import { generateOutlineAction } from "@/lib/outline.actions";
import { CopyTextButton } from "./CopyTextButton";
import { ResultMessage } from "./ResultMessage";

function toPlainText(payload: OutlinePayload): string {
  return [
    `HOOK\n${payload.hook}`,
    `RE-HOOK\n${payload.rehook}`,
    `TEACHING POINTS\n${payload.teaching_points.map((t) => `- ${t}`).join("\n")}`,
    `TWIST\n${payload.twist}`,
    `CTA\n${payload.cta}`,
  ].join("\n\n");
}

/** A stored failed generation (PR-16), surfaced by PR-29. */
export type OutlineFailure = { error: string | null; rawResponse: string | null };

export function IdeaOutline({
  analysisId,
  ideaIndex,
  videoId,
  outline,
  failure,
  canGenerate,
}: {
  analysisId: number;
  ideaIndex: number;
  videoId: number;
  outline: OutlinePayload | null;
  failure: OutlineFailure | null;
  canGenerate: boolean;
}) {
  const t = useTranslator();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Generating an outline is a paid API call, so an employee sees nothing here
  // rather than a button that will be refused (PR-24) — except a past failure,
  // which is a fact about this analysis rather than an offer to spend.
  if (!outline) {
    if (!canGenerate) return failure ? <FailureDetails failure={failure} /> : null;
    return (
      <div className="mt-2 flex flex-col items-start gap-2">
        {failure && <FailureDetails failure={failure} />}
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await generateOutlineAction(analysisId, ideaIndex, videoId);
              if (!result.ok) setError(result.error);
            })
          }
          className="surface-border rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium text-[var(--color-ink)] hover:border-[var(--color-accent)] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          {pending ? t("outline.generating") : t(failure ? "outline.retry" : "outline.generate")}
        </button>
        {error && <ResultMessage tone="error">{error}</ResultMessage>}
      </div>
    );
  }

  return (
    <div className="surface-border mt-3 flex flex-col gap-2 rounded-[var(--radius-sm)] bg-[var(--color-surface)] p-3 text-xs">
      <OutlineField label={t("outline.hook")} value={outline.hook} />
      <OutlineField label={t("outline.rehook")} value={outline.rehook} />
      <div>
        <p className="text-[var(--color-ink-muted)]">{t("outline.teachingPoints")}</p>
        <ul className="mt-0.5 list-disc pl-4 text-[var(--color-ink)]">
          {outline.teaching_points.map((point, i) => (
            <li key={i}>{point}</li>
          ))}
        </ul>
      </div>
      <OutlineField label={t("outline.twist")} value={outline.twist} />
      <OutlineField label={t("outline.cta")} value={outline.cta} />
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(toPlainText(outline));
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }}
        className="mt-1 w-fit rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 py-1.5 font-medium text-[var(--color-accent-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      >
        {copied ? t("video.copied") : t("outline.copy")}
      </button>
    </div>
  );
}

function OutlineField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[var(--color-ink-muted)]">{label}</p>
      <p className="text-[var(--color-ink)]">{value}</p>
    </div>
  );
}

/**
 * A past failure, collapsed.
 *
 * PR-16 stores the error and the raw response for a failed generation; until
 * now nothing rendered them, so the row it went to the trouble of writing was
 * as invisible as the toast it replaced. Collapsed rather than inline because
 * the common case is a retry that works, and a stack of red boxes under every
 * idea would bury the ideas themselves.
 */
function FailureDetails({ failure }: { failure: OutlineFailure }) {
  const t = useTranslator();

  return (
    <details className="mt-2 w-full text-xs">
      <summary className="cursor-pointer text-[var(--color-danger)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]">
        {t("outline.failed")}
      </summary>
      <div className="mt-2 flex flex-col items-start gap-2">
        <p className="text-[var(--color-ink-muted)]">
          {failure.error ?? t("outline.failedNoMessage")}
        </p>
        {failure.rawResponse && (
          <>
            <pre className="surface-border max-h-48 w-full overflow-auto rounded-[var(--radius-sm)] bg-[var(--color-surface)] p-2 text-[var(--color-ink-muted)]">
              {failure.rawResponse}
            </pre>
            <CopyTextButton text={failure.rawResponse} label={t("video.copyRaw")} />
          </>
        )}
      </div>
    </details>
  );
}
