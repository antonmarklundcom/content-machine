"use client";

import { useActionState } from "react";
import { importFactsAction, type FactImportActionResult } from "@/lib/facts.actions";
import { translator, type Locale } from "@/lib/i18n";
import { ResultMessage } from "./ResultMessage";

const FIELD =
  "surface-border w-full rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
const LABEL = "text-xs font-medium text-[var(--color-ink-muted)]";

/**
 * "Import facts" (S18, §1.48): a family, and a source file or its URL. The
 * same import as `npm run facts:import`; the owner's only.
 */
export function FactImportForm({
  families,
  familyId,
  locale,
}: {
  families: Array<{ id: string; name: string }>;
  familyId?: string;
  locale: Locale;
}) {
  const t = translator(locale);
  const [state, formAction, pending] = useActionState(
    importFactsAction,
    null as FactImportActionResult | null,
  );

  if (families.length === 0)
    return <p className="text-sm text-[var(--color-ink-muted)]">{t("facts.import.noFamilies")}</p>;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div>
        <h2 className="text-base font-semibold text-[var(--color-ink)]">
          {t("facts.import.title")}
        </h2>
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{t("facts.import.note")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <label className="flex flex-col gap-1" htmlFor="fact-import-family">
          <span className={LABEL}>{t("facts.import.family")}</span>
          <select
            id="fact-import-family"
            name="family"
            required
            defaultValue={familyId ?? families[0]?.id}
            className={FIELD}
          >
            {families.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1" htmlFor="fact-import-file">
          <span className={LABEL}>{t("facts.import.file")}</span>
          <input
            id="fact-import-file"
            name="file"
            type="file"
            accept=".ts,.txt,.json,text/plain,application/json"
            className={FIELD}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1" htmlFor="fact-import-url">
        <span className={LABEL}>{t("facts.import.url")}</span>
        <input
          id="fact-import-url"
          name="url"
          type="url"
          placeholder={t("facts.import.urlPlaceholder")}
          className={FIELD}
        />
      </label>
      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          {pending ? t("facts.import.running") : t("facts.import.submit")}
        </button>
      </div>
      {state && !state.ok && (
        <ResultMessage tone="error">
          {t(state.error)}
          {state.detail ? ` (${state.detail})` : ""}
        </ResultMessage>
      )}
      {state?.ok && (
        <ResultMessage tone="success">
          {t("facts.import.done", {
            keys: state.keys,
            rows: state.rows,
            inserted: state.inserted,
            updated: state.updated,
            unchanged: state.unchanged,
          })}
        </ResultMessage>
      )}
    </form>
  );
}
