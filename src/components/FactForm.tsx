"use client";

import { useActionState, useEffect, useRef } from "react";
import type { FactActionResult } from "@/lib/facts.actions";
import { translator, type Locale } from "@/lib/i18n";
import { ResultMessage } from "./ResultMessage";

const FIELD =
  "surface-border w-full rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
const LABEL = "text-xs font-medium text-[var(--color-ink-muted)]";

export type FactFormValues = { topic: string; claim: string; sourceUrl: string; notes: string };

/**
 * Add or edit one fact (build 2b, idea 3). The action is bound by the caller —
 * `createFactAction` to a brand, `updateFactAction` to a fact id — so one form
 * serves both. A successful add clears the form; a successful edit calls `onDone`.
 */
export function FactForm({
  action,
  initial,
  topics,
  locale,
  idPrefix,
  submitLabel,
  onDone,
  onCancel,
}: {
  action: (prev: FactActionResult | null, formData: FormData) => Promise<FactActionResult>;
  initial?: FactFormValues;
  /** Existing topics, offered as suggestions so a sheet does not grow near-duplicates. */
  topics: string[];
  locale: Locale;
  idPrefix: string;
  submitLabel: string;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const t = translator(locale);
  const [state, formAction, pending] = useActionState(action, null as FactActionResult | null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state?.ok) return;
    if (onDone) onDone();
    else formRef.current?.reset();
  }, [state, onDone]);

  const id = (name: string) => `${idPrefix}-${name}`;
  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <label className="flex flex-col gap-1" htmlFor={id("topic")}>
          <span className={LABEL}>{t("facts.field.topic")}</span>
          <input
            id={id("topic")}
            name="topic"
            required
            list={`${idPrefix}-topics`}
            defaultValue={initial?.topic}
            placeholder={t("facts.field.topicPlaceholder")}
            className={FIELD}
          />
          <datalist id={`${idPrefix}-topics`}>
            {topics.map((topic) => (
              <option key={topic} value={topic} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1" htmlFor={id("sourceUrl")}>
          <span className={LABEL}>{t("facts.field.sourceUrl")}</span>
          <input
            id={id("sourceUrl")}
            name="sourceUrl"
            type="url"
            defaultValue={initial?.sourceUrl}
            placeholder="https://"
            className={FIELD}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1" htmlFor={id("claim")}>
        <span className={LABEL}>{t("facts.field.claim")}</span>
        <textarea
          id={id("claim")}
          name="claim"
          required
          rows={2}
          defaultValue={initial?.claim}
          placeholder={t("facts.field.claimPlaceholder")}
          className={FIELD}
        />
      </label>
      <label className="flex flex-col gap-1" htmlFor={id("notes")}>
        <span className={LABEL}>{t("facts.field.notes")}</span>
        <textarea
          id={id("notes")}
          name="notes"
          rows={1}
          defaultValue={initial?.notes}
          className={FIELD}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          {pending ? t("facts.adding") : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="surface-border rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium text-[var(--color-ink)] hover:border-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
          >
            {t("facts.cancel")}
          </button>
        )}
      </div>
      {state && !state.ok && (
        <ResultMessage tone="error">
          {t(state.error)}
          {state.detail ? ` (${state.detail})` : ""}
        </ResultMessage>
      )}
      {state?.ok && !onDone && <ResultMessage tone="success">{t("facts.added")}</ResultMessage>}
    </form>
  );
}
