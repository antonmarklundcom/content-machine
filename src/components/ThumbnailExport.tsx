"use client";

import { useState } from "react";
import { useTranslator } from "@/lib/i18n/client";
import { STUDIO_BUTTON } from "./StudioStyles";

/** Copy or download `/api/scripts/[id]/export?format=thumbnails` — the saved script's three concepts. */
export function ThumbnailExport({ scriptId }: { scriptId: number }) {
  const t = useTranslator();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const url = `/api/scripts/${scriptId}/export?format=thumbnails`;

  async function copy() {
    setFailed(false);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      await navigator.clipboard.writeText(await res.text());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={STUDIO_BUTTON} onClick={copy}>
        {copied ? t("listing.thumbs.copied") : t("listing.thumbs.copy")}
      </button>
      <a className={STUDIO_BUTTON} href={`${url}&download=1`}>
        {t("listing.thumbs.download")}
      </a>
      {failed && <span className="text-xs text-[var(--color-danger)]">{t("listing.error")}</span>}
    </div>
  );
}
