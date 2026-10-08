"use client";

import { useState, useTransition } from "react";

import { useTranslator } from "@/lib/i18n/client";
import { fillPostLeadUrlAction, setPostLeadUrlAction } from "@/lib/leads.actions";

import { CopyTextButton } from "./CopyTextButton";
import { ResultMessage, type ResultTone } from "./ResultMessage";
import { STUDIO_BUTTON, STUDIO_INPUT, STUDIO_LABEL } from "./StudioStyles";

/**
 * The post editor's lead link (build 4 §3.G): the CTA URL with UTMs. "Fill
 * from kit" builds it from the brand kit's base URL; it can also be typed or
 * cleared by hand. Mount on the post editor with the post's id, its current
 * `lead_url` and its brand kit's `lead_base_url`.
 */
export function LeadLinkField({
  postId,
  current,
  kitBase,
}: {
  postId: number;
  current: string | null;
  kitBase: string | null;
}) {
  const t = useTranslator();
  const [value, setValue] = useState(current ?? "");
  const [campaign, setCampaign] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ tone: ResultTone; text: string } | null>(null);

  const run = (
    fn: () => Promise<{ ok: true; url: string | null } | { ok: false; error: string }>,
  ) =>
    startTransition(async () => {
      setResult(null);
      const res = await fn();
      if (res.ok) {
        setValue(res.url ?? "");
        setResult({ tone: "success", text: t("growth.lead.saved") });
      } else setResult({ tone: "error", text: res.error });
    });

  return (
    <div className="flex flex-col gap-2">
      <label className={STUDIO_LABEL} htmlFor={`lead-url-${postId}`}>
        {t("growth.lead.postLabel")}
      </label>
      <input
        id={`lead-url-${postId}`}
        type="url"
        value={value}
        maxLength={1024}
        placeholder="https://…"
        onChange={(e) => setValue(e.target.value)}
        className={STUDIO_INPUT}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          className={STUDIO_BUTTON}
          onClick={() => run(() => setPostLeadUrlAction(postId, value))}
        >
          {t("growth.lead.save")}
        </button>
        {kitBase ? (
          <>
            <input
              aria-label={t("growth.lead.campaign")}
              placeholder={t("growth.lead.campaign")}
              value={campaign}
              maxLength={80}
              onChange={(e) => setCampaign(e.target.value)}
              className={`${STUDIO_INPUT} max-w-[12rem]`}
            />
            <button
              type="button"
              disabled={pending}
              className={STUDIO_BUTTON}
              onClick={() => run(() => fillPostLeadUrlAction(postId, campaign))}
            >
              {t("growth.lead.fill")}
            </button>
          </>
        ) : (
          <span className="text-xs text-[var(--color-ink-muted)]">{t("growth.lead.noBase")}</span>
        )}
        {value ? <CopyTextButton text={value} label={t("growth.copy")} /> : null}
      </div>
      {result ? <ResultMessage tone={result.tone}>{result.text}</ResultMessage> : null}
    </div>
  );
}
