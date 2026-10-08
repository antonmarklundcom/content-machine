"use client";

import { useActionState, useEffect, useRef } from "react";
import { createHookAction, type HookActionResult } from "@/lib/facts.actions";
import { translator, type Locale } from "@/lib/i18n";
import { ResultMessage } from "./ResultMessage";

const FIELD =
  "surface-border w-full rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
const LABEL = "text-xs font-medium text-[var(--color-ink-muted)]";

export type HookScopeOption = { value: string; label: string };

/** Quick add on `/hooks`: text, kind, and whose it is (a brand, a family or everyone). */
export function HookAddForm({
  scopes,
  defaultScope,
  defaultKind,
  locale,
}: {
  scopes: HookScopeOption[];
  defaultScope: string;
  defaultKind: string;
  locale: Locale;
}) {
  const t = translator(locale);
  const [state, formAction, pending] = useActionState(
    createHookAction,
    null as HookActionResult | null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Keep kind and scope for the next one; only the text starts over.
    if (state?.ok && textRef.current) textRef.current.value = "";
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1" htmlFor="hook-new-text">
        <span className={LABEL}>{t("hooks.field.text")}</span>
        <textarea
          ref={textRef}
          id="hook-new-text"
          name="text"
          required
          rows={2}
          placeholder={t("hooks.field.textPlaceholder")}
          className={FIELD}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1" htmlFor="hook-new-kind">
          <span className={LABEL}>{t("hooks.field.kind")}</span>
          <select id="hook-new-kind" name="kind" defaultValue={defaultKind} className={FIELD}>
            <option value="hook">{t("hooks.kind.hook")}</option>
            <option value="cta">{t("hooks.kind.cta")}</option>
            <option value="caption_pattern">{t("hooks.kind.caption_pattern")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1" htmlFor="hook-new-scope">
          <span className={LABEL}>{t("hooks.field.scope")}</span>
          <select id="hook-new-scope" name="scope" defaultValue={defaultScope} className={FIELD}>
            {scopes.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          {pending ? t("hooks.adding") : t("hooks.add")}
        </button>
      </div>
      {state && !state.ok && (
        <ResultMessage tone="error">
          {t(state.error)}
          {state.detail ? ` (${state.detail})` : ""}
        </ResultMessage>
      )}
      {state?.ok && <ResultMessage tone="success">{t("hooks.added")}</ResultMessage>}
    </form>
  );
}
