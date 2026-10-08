"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslator } from "@/lib/i18n/client";
import { generateReportAction } from "@/lib/report.actions";
import { ResultMessage, type ResultTone } from "./ResultMessage";
import { STUDIO_PRIMARY } from "./StudioStyles";

/** "Generate now" on the report page (build 2b, idea 1). Rendered for the owner only. */
export function ReportGenerateButton({ brandId }: { brandId: string }) {
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
            const res = await generateReportAction(brandId);
            if (res.ok) {
              setResult({ tone: "success", text: t("report.generated") });
              router.push(`/research/report?${new URLSearchParams({ brand: brandId })}`);
              router.refresh();
            } else {
              setResult({ tone: "error", text: res.error });
            }
          })
        }
      >
        {pending ? t("report.generating") : t("report.generate")}
      </button>
      {result && <ResultMessage tone={result.tone}>{result.text}</ResultMessage>}
    </div>
  );
}
