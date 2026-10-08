"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslator } from "@/lib/i18n/client";
import { mineQuestionsAction } from "@/lib/report.actions";
import { ResultMessage, type ResultTone } from "./ResultMessage";
import { STUDIO_PRIMARY } from "./StudioStyles";

/** "Mine comments" on the questions page (build 2b, idea 2). Rendered for the owner only. */
export function QuestionMineButton({ brandId }: { brandId: string }) {
  const t = useTranslator();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ tone: ResultTone; text: string } | null>(null);

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        disabled={pending}
        className={STUDIO_PRIMARY}
        onClick={() =>
          startTransition(async () => {
            setResult(null);
            const res = await mineQuestionsAction(brandId);
            if (res.ok) {
              setResult({
                tone: "success",
                text: t("questions.mined", {
                  comments: res.comments,
                  videos: res.videos,
                  inserted: res.inserted,
                  updated: res.updated,
                }),
              });
              router.refresh();
            } else {
              setResult({ tone: "error", text: res.error });
            }
          })
        }
      >
        {pending ? t("questions.mining") : t("questions.mine")}
      </button>
      {result && <ResultMessage tone={result.tone}>{result.text}</ResultMessage>}
    </div>
  );
}
