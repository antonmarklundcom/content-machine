"use client";

import { useState } from "react";
import type { TranslationKey } from "@/lib/i18n";
import { useTranslator } from "@/lib/i18n/client";
import { STUDIO_BUTTON } from "./StudioStyles";

const FORMATS: { format: "md" | "json" | "shots"; label: TranslationKey }[] = [
  { format: "md", label: "studio.export.md" },
  { format: "json", label: "studio.export.json" },
  { format: "shots", label: "studio.export.shots" },
];

/**
 * Copy or download O8's three exports (`/api/scripts/[id]/export`). They read
 * the saved script, so the editor's unsaved edits are not in them.
 */
export function StudioExports({ scriptId }: { scriptId: number }) {
  const t = useTranslator();
  const [copied, setCopied] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const url = (format: string) => `/api/scripts/${scriptId}/export?format=${format}`;

  async function copy(format: string) {
    setFailed(false);
    try {
      const res = await fetch(url(format));
      if (!res.ok) throw new Error(String(res.status));
      await navigator.clipboard.writeText(await res.text());
      setCopied(format);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {FORMATS.map(({ format, label }) => (
        <div key={format} className="flex flex-wrap items-center gap-2">
          <span className="w-28 text-xs text-[var(--color-ink-muted)]">{t(label)}</span>
          <button type="button" className={STUDIO_BUTTON} onClick={() => copy(format)}>
            {copied === format ? t("studio.export.copied") : t("studio.export.copy")}
          </button>
          <a className={STUDIO_BUTTON} href={`${url(format)}&download=1`}>
            {t("studio.export.download")}
          </a>
        </div>
      ))}
      {failed && (
        <span className="text-xs text-[var(--color-danger)]">{t("studio.error.generic")}</span>
      )}
    </div>
  );
}
