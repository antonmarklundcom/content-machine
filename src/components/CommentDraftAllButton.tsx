"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { draftAllNewAction } from "@/lib/comments.actions";
import { useTranslator } from "@/lib/i18n/client";

import { ResultMessage, type ResultTone } from "./ResultMessage";
import { STUDIO_PRIMARY } from "./StudioStyles";

/** "Draft all new" on `/comments` (build 4 §3.G). Owner only; spends one call per comment. */
export function CommentDraftAllButton({
  accountIds,
  count,
  estimate,
}: {
  accountIds: number[];
  count: number;
  /** Formatted worst-case cost for `count` comments. */
  estimate: string;
}) {
  const t = useTranslator();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ tone: ResultTone; text: string } | null>(null);

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        disabled={pending || count === 0}
        className={STUDIO_PRIMARY}
        onClick={() =>
          startTransition(async () => {
            setResult(null);
            const res = await draftAllNewAction(accountIds);
            if (res.ok) {
              setResult({
                tone: res.errors.length ? "info" : "success",
                text:
                  t("growth.comments.draftedAll", {
                    n: res.drafted,
                    human: res.needsHuman,
                    cost: res.cost,
                  }) + (res.errors.length ? ` ${res.errors.join("; ")}` : ""),
              });
              router.refresh();
            } else setResult({ tone: "error", text: res.error });
          })
        }
      >
        {pending ? t("growth.comments.drafting") : t("growth.comments.draftAll", { n: count })}
      </button>
      <span className="text-xs text-[var(--color-ink-muted)]">
        {t("growth.estimate", { cost: estimate })}
      </span>
      {result ? <ResultMessage tone={result.tone}>{result.text}</ResultMessage> : null}
    </div>
  );
}
