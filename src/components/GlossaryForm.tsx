"use client";

import { useActionState, useEffect, useRef } from "react";
import type { GlossaryRegister } from "@/db/schema";
import { GLOSSARY_BUTTON, GLOSSARY_FIELD, REGISTERS } from "@/lib/glossary/ui";
import type { GlossaryActionResult } from "@/lib/glossary.actions";
import { translator, type Locale } from "@/lib/i18n";
import { ResultMessage } from "./ResultMessage";

const LABEL = "text-xs font-medium text-[var(--color-ink-muted)]";
export type GlossaryFormValues = {
  term: string;
  meaningEs: string;
  meaningEn: string;
  sayAs: string;
  partOfSpeech: string;
  register: GlossaryRegister;
  joparaOk: boolean;
  example: string;
  exampleTranslation: string;
  source: string;
  notes: string;
};

export const EMPTY_GLOSSARY_VALUES: GlossaryFormValues = {
  term: "",
  meaningEs: "",
  meaningEn: "",
  sayAs: "",
  partOfSpeech: "",
  register: "everyday",
  joparaOk: false,
  example: "",
  exampleTranslation: "",
  source: "",
  notes: "",
};

/** Add or edit one glossary term. Review is done on the row, not here. */
export function GlossaryForm({
  action,
  initial = EMPTY_GLOSSARY_VALUES,
  idPrefix,
  submitLabel,
  locale,
  onDone,
  onCancel,
}: {
  action: (prev: GlossaryActionResult | null, form: FormData) => Promise<GlossaryActionResult>;
  initial?: GlossaryFormValues;
  idPrefix: string;
  submitLabel: string;
  locale: Locale;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const t = translator(locale);
  const [state, formAction, pending] = useActionState(action, null);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      if (onDone) onDone();
      else formRef.current?.reset();
    }
  }, [state, onDone]);

  const text = (name: keyof GlossaryFormValues, label: string, required = false) => (
    <label className="flex flex-col gap-1" htmlFor={`${idPrefix}-${name}`}>
      <span className={LABEL}>{label}</span>
      <input
        id={`${idPrefix}-${name}`}
        name={name}
        required={required}
        defaultValue={String(initial[name])}
        className={GLOSSARY_FIELD}
      />
    </label>
  );

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {text("term", t("glossary.field.term"), true)}
        {text("sayAs", t("glossary.field.sayAs"))}
        {text("meaningEs", t("glossary.field.meaningEs"))}
        {text("meaningEn", t("glossary.field.meaningEn"))}
        {text("partOfSpeech", t("glossary.field.partOfSpeech"))}
        <label className="flex flex-col gap-1" htmlFor={`${idPrefix}-register`}>
          <span className={LABEL}>{t("glossary.field.register")}</span>
          <select
            id={`${idPrefix}-register`}
            name="register"
            defaultValue={initial.register}
            className={GLOSSARY_FIELD}
          >
            {REGISTERS.map((r) => (
              <option key={r} value={r}>
                {t(`glossary.register.${r}`)}
              </option>
            ))}
          </select>
        </label>
        {text("example", t("glossary.field.example"))}
        {text("exampleTranslation", t("glossary.field.exampleTranslation"))}
        {text("source", t("glossary.field.source"))}
        {text("notes", t("glossary.field.notes"))}
      </div>
      <label className="flex items-center gap-2 text-sm text-[var(--color-ink)]">
        <input type="checkbox" name="joparaOk" defaultChecked={initial.joparaOk} />
        {t("glossary.field.joparaOk")}
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={GLOSSARY_BUTTON}>
          {submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="surface-border rounded-[var(--radius-sm)] px-4 py-2 text-sm text-[var(--color-ink)]"
          >
            {t("glossary.cancel")}
          </button>
        )}
      </div>
      {state && !state.ok && (
        <ResultMessage tone="error">
          {t(state.error)}
          {state.detail ? ` (${state.detail})` : ""}
        </ResultMessage>
      )}
    </form>
  );
}
