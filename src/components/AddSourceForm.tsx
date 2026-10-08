"use client";

import { useActionState } from "react";
import { translator, type Locale } from "@/lib/i18n";
import { addSource, type AddSourceResult } from "@/lib/sources.actions";
import { ResultMessage } from "./ResultMessage";

const initialState: AddSourceResult | null = null;

export function AddSourceForm({ locale }: { locale: Locale }) {
  const t = translator(locale);
  const [state, formAction, pending] = useActionState(addSource, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-3">
        <label className="sr-only" htmlFor="add-source-url">
          {t("sources.addPlaceholder")}
        </label>
        <input
          id="add-source-url"
          type="text"
          name="url"
          required
          placeholder={t("sources.addPlaceholder")}
          className="surface-border min-w-72 flex-1 rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          {pending ? t("sources.adding") : t("sources.add")}
        </button>
      </div>
      {state && !state.ok && <ResultMessage tone="error">{state.error}</ResultMessage>}
      {state && state.ok && <ResultMessage tone="success">{t("sources.added")}</ResultMessage>}
    </form>
  );
}
