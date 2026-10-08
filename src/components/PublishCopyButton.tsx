"use client";

import { useState } from "react";
import { useTranslator } from "@/lib/i18n/client";
import { STUDIO_BUTTON } from "./StudioStyles";

/** Copy a field's current text; says "Copied" for a moment. */
export function PublishCopyButton({ text, label }: { text: string; label?: string }) {
  const t = useTranslator();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={STUDIO_BUTTON}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          // Clipboard refused (insecure origin, permissions): the text is on the page to select.
        }
      }}
    >
      {copied ? t("studio.export.copied") : (label ?? t("publish.copy"))}
    </button>
  );
}

/** Download text as a Markdown file, built in the browser. */
export function PublishDownloadButton({
  text,
  filename,
  label,
}: {
  text: string;
  filename: string;
  label: string;
}) {
  return (
    <button
      type="button"
      className={STUDIO_BUTTON}
      onClick={() => {
        const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}
    >
      {label}
    </button>
  );
}
