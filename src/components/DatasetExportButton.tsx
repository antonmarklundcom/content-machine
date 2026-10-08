"use client";

import { useState, useTransition } from "react";

import { exportDatasetAction, type DatasetActionResult } from "@/lib/dataset.actions";
import { translator, type Locale } from "@/lib/i18n";

import { ResultMessage } from "./ResultMessage";
import { VOICE_BUTTON } from "./VoiceStyles";

/** One profile × language: export, then show the folder and summary. */
export function DatasetExportButton({
  profileKey,
  language,
  disabled,
  locale,
}: {
  profileKey: string;
  language: string;
  disabled?: boolean;
  locale: Locale;
}) {
  const t = translator(locale);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<DatasetActionResult | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className={VOICE_BUTTON}
        disabled={disabled || pending}
        onClick={() =>
          start(async () => setResult(await exportDatasetAction(profileKey, language)))
        }
      >
        {pending ? t("dataset.exporting") : t("dataset.export")}
      </button>
      {result?.ok ? (
        <ResultMessage tone="success">
          {t("dataset.done", {
            clips: result.summary.clips,
            minutes: (result.summary.totalSeconds / 60).toFixed(1),
            folder: result.summary.absoluteFolder ?? result.summary.folder ?? "",
          })}
          {result.summary.excluded.length > 0 && (
            <> {t("dataset.excluded", { count: result.summary.excluded.length })}</>
          )}
        </ResultMessage>
      ) : result ? (
        <ResultMessage tone="error">
          {t(result.error)}
          {result.detail ? ` ${result.detail}` : ""}
        </ResultMessage>
      ) : null}
    </div>
  );
}
