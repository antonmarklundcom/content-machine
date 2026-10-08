"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { findGapsAction } from "@/lib/gaps.actions";
import { useTranslator } from "@/lib/i18n/client";

import { ResultMessage, type ResultTone } from "./ResultMessage";
import { STUDIO_PRIMARY } from "./StudioStyles";

/** "Find gaps" on `/research/gaps` (build 4 §3.G). Owner only; shows the worst-case cost first. */
export function GapRunButton({
  brandId,
  estimate,
  disabled,
}: {
  brandId: string;
  estimate: string;
  disabled?: boolean;
}) {
  const t = useTranslator();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ tone: ResultTone; text: string } | null>(null);

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        disabled={pending || disabled}
        className={STUDIO_PRIMARY}
        onClick={() =>
          startTransition(async () => {
            setResult(null);
            const res = await findGapsAction(brandId);
            if (res.ok) {
              setResult({
                tone: "success",
                text: t("growth.gaps.found", {
                  n: res.found,
                  dropped: res.dropped,
                  cost: res.cost,
                }),
              });
              router.refresh();
            } else setResult({ tone: "error", text: res.error });
          })
        }
      >
        {pending ? t("growth.gaps.running") : t("growth.gaps.run")}
      </button>
      <span className="text-xs text-[var(--color-ink-muted)]">
        {t("growth.estimate", { cost: estimate })}
      </span>
      {result ? <ResultMessage tone={result.tone}>{result.text}</ResultMessage> : null}
    </div>
  );
}
