"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import {
  importGlossaryAction,
  importSeedAction,
  type GlossaryActionResult,
} from "@/lib/glossary.actions";
import { translator, type Locale } from "@/lib/i18n";
import { GLOSSARY_BUTTON, GLOSSARY_FIELD } from "@/lib/glossary/ui";
import { ResultMessage } from "./ResultMessage";

function Outcome({ state, locale }: { state: GlossaryActionResult | null; locale: Locale }) {
  const t = translator(locale);
  if (!state) return null;
  if (!state.ok)
    return (
      <ResultMessage tone="error">
        {t(state.error)}
        {state.detail ? ` (${state.detail})` : ""}
      </ResultMessage>
    );
  return (
    <ResultMessage tone="success">
      {t("glossary.import.done", {
        rows: state.rows ?? 0,
        inserted: state.inserted ?? 0,
        updated: state.updated ?? 0,
      })}
    </ResultMessage>
  );
}

/** CSV import, "Import seed" and the CSV export link. */
export function GlossaryImport({ locale }: { locale: Locale }) {
  const t = translator(locale);
  const router = useRouter();
  const [state, formAction, pending] = useActionState(importGlossaryAction, null);
  const [seed, setSeed] = useState<GlossaryActionResult | null>(null);
  const [seeding, startSeed] = useTransition();

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-base font-semibold text-[var(--color-ink)]">
        {t("glossary.import.title")}
      </h2>
      <p className="text-xs text-[var(--color-ink-muted)]">{t("glossary.import.note")}</p>
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input
          aria-label={t("glossary.import.file")}
          name="file"
          type="file"
          accept=".csv,text/csv"
          className={`${GLOSSARY_FIELD} max-w-sm`}
        />
        <button type="submit" disabled={pending} className={GLOSSARY_BUTTON}>
          {t("glossary.import.submit")}
        </button>
        <a
          href="/glossary/export"
          className="surface-border rounded-[var(--radius-sm)] px-4 py-2 text-sm text-[var(--color-ink)] hover:border-[var(--color-accent)]"
        >
          {t("glossary.export")}
        </a>
        <button
          type="button"
          disabled={seeding}
          onClick={() =>
            startSeed(async () => {
              const r = await importSeedAction();
              setSeed(r);
              if (r.ok) router.refresh();
            })
          }
          className="surface-border rounded-[var(--radius-sm)] px-4 py-2 text-sm text-[var(--color-ink)] hover:border-[var(--color-accent)] disabled:opacity-50"
        >
          {t("glossary.import.seed")}
        </button>
      </form>
      <Outcome state={state} locale={locale} />
      <Outcome state={seed} locale={locale} />
    </div>
  );
}
