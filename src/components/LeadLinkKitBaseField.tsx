"use client";

import { useState, useTransition } from "react";

import { useTranslator } from "@/lib/i18n/client";
import { setKitLeadBaseAction } from "@/lib/leads.actions";

import { ResultMessage, type ResultTone } from "./ResultMessage";
import { STUDIO_BUTTON, STUDIO_INPUT, STUDIO_LABEL } from "./StudioStyles";

/**
 * The brand kit's lead base URL (build 4 §3.G): the brand's site or VenderCRM
 * form that every post's lead link starts from. Mount on the brand kit editor
 * with the brand id and the kit's current `lead_base_url`.
 */
export function KitLeadBaseField({
  brandId,
  current,
}: {
  brandId: string;
  current: string | null;
}) {
  const t = useTranslator();
  const [value, setValue] = useState(current ?? "");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ tone: ResultTone; text: string } | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <label className={STUDIO_LABEL} htmlFor={`lead-base-${brandId}`}>
        {t("growth.lead.kitLabel")}
      </label>
      <input
        id={`lead-base-${brandId}`}
        type="url"
        value={value}
        maxLength={900}
        placeholder="https://…"
        onChange={(e) => setValue(e.target.value)}
        className={STUDIO_INPUT}
      />
      <p className="text-xs text-[var(--color-ink-muted)]">{t("growth.lead.kitHint")}</p>
      <div>
        <button
          type="button"
          disabled={pending}
          className={STUDIO_BUTTON}
          onClick={() =>
            startTransition(async () => {
              setResult(null);
              const res = await setKitLeadBaseAction(brandId, value);
              if (res.ok) {
                setValue(res.url ?? "");
                setResult({ tone: "success", text: t("growth.lead.saved") });
              } else setResult({ tone: "error", text: res.error });
            })
          }
        >
          {t("growth.lead.save")}
        </button>
      </div>
      {result ? <ResultMessage tone={result.tone}>{result.text}</ResultMessage> : null}
    </div>
  );
}
