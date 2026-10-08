"use client";

import { useActionState, useEffect, useRef } from "react";

import { translator, type Locale } from "@/lib/i18n";
import { VOICE_LANGUAGES } from "@/lib/voice/contract";
import type { VoiceActionResult } from "@/lib/voice.actions";

import { ResultMessage } from "./ResultMessage";
import { VOICE_BUTTON, VOICE_INPUT, VOICE_LABEL, VOICE_PRIMARY } from "./VoiceStyles";

export type PronunciationFormValues = {
  term: string;
  sayAs: string;
  language: string;
  scope: string;
  notes: string;
};

/** Add or edit one respelling. The caller binds the action (create, or update by id). */
export function PronunciationForm({
  action,
  initial,
  locale,
  idPrefix,
  submitLabel,
  onDone,
  onCancel,
}: {
  action: (prev: VoiceActionResult | null, formData: FormData) => Promise<VoiceActionResult>;
  initial?: PronunciationFormValues;
  locale: Locale;
  idPrefix: string;
  submitLabel: string;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const t = translator(locale);
  const [state, formAction, pending] = useActionState(action, null as VoiceActionResult | null);
  const formRef = useRef<HTMLFormElement>(null);
  const id = (name: string) => `${idPrefix}-${name}`;

  useEffect(() => {
    if (!state?.ok) return;
    if (onDone) onDone();
    else formRef.current?.reset();
  }, [state, onDone]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1" htmlFor={id("term")}>
          <span className={VOICE_LABEL}>{t("voice.pron.term")}</span>
          <input
            id={id("term")}
            name="term"
            required
            defaultValue={initial?.term}
            placeholder="Ypacaraí"
            className={VOICE_INPUT}
          />
        </label>
        <label className="flex flex-col gap-1" htmlFor={id("sayAs")}>
          <span className={VOICE_LABEL}>{t("voice.pron.sayAs")}</span>
          <input
            id={id("sayAs")}
            name="sayAs"
            required
            defaultValue={initial?.sayAs}
            placeholder="Ipacaraí"
            className={VOICE_INPUT}
          />
        </label>
        <label className="flex flex-col gap-1" htmlFor={id("language")}>
          <span className={VOICE_LABEL}>{t("voice.language")}</span>
          <select
            id={id("language")}
            name="language"
            defaultValue={initial?.language ?? "*"}
            className={VOICE_INPUT}
          >
            <option value="*">{t("voice.anyLanguage")}</option>
            {VOICE_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1" htmlFor={id("scope")}>
          <span className={VOICE_LABEL}>{t("voice.pron.scope")}</span>
          <input
            id={id("scope")}
            name="scope"
            defaultValue={initial?.scope ?? "global"}
            placeholder={t("voice.pron.scopeHelp")}
            className={VOICE_INPUT}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1" htmlFor={id("notes")}>
        <span className={VOICE_LABEL}>{t("voice.field.notes")}</span>
        <input
          id={id("notes")}
          name="notes"
          defaultValue={initial?.notes}
          className={VOICE_INPUT}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={VOICE_PRIMARY}>
          {pending ? t("voice.saving") : submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={VOICE_BUTTON}>
            {t("voice.cancel")}
          </button>
        )}
      </div>
      {state && !state.ok && (
        <ResultMessage tone="error">
          {t(state.error)}
          {state.detail ? ` (${state.detail})` : ""}
        </ResultMessage>
      )}
      {state?.ok && !onDone && <ResultMessage tone="success">{t("voice.saved")}</ResultMessage>}
    </form>
  );
}
