"use client";

import { useActionState, useState, useTransition } from "react";
import type { Locale } from "@/lib/i18n";
import { translator } from "@/lib/i18n";
import { saveSettingsAction, testSettingAction, type SettingsResult } from "@/lib/settings.actions";
import type { SettingField } from "@/lib/settings/fields";

type FieldView = SettingField & { isSet: boolean; display: string };

const INPUT =
  "mt-1 w-full rounded-[var(--radius-sm)] surface-border bg-transparent px-3 py-2 text-sm text-[var(--color-ink)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
const BUTTON =
  "rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium surface-border text-[var(--color-ink)] hover:border-[var(--color-accent)] disabled:opacity-50";

function TestButton({
  which,
  locale,
}: {
  which: NonNullable<SettingField["test"]>;
  locale: Locale;
}) {
  const t = translator(locale);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<SettingsResult | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className={BUTTON}
        disabled={pending}
        onClick={() => start(async () => setResult(await testSettingAction(which)))}
      >
        {pending ? t("settings.testing") : t("settings.test")}
      </button>
      {result && (
        <span
          role="status"
          className={`text-xs ${result.ok ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}
        >
          {result.ok ? result.message : result.error}
        </span>
      )}
    </span>
  );
}

/** The settings form: one row per key, masked current value, save + test. */
export function SettingsForm({ fields, locale }: { fields: FieldView[]; locale: Locale }) {
  const t = translator(locale);
  const [state, action, pending] = useActionState(saveSettingsAction, null);

  return (
    <form action={action} className="mt-6 space-y-4">
      {fields.map((f) => (
        <div key={f.key} className="surface-card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <label htmlFor={`s-${f.key}`} className="font-medium text-[var(--color-ink)]">
              {f.label}
            </label>
            <span className="text-xs text-[var(--color-muted)]">
              {f.isSet
                ? `${t("settings.set")}${f.display ? ` · ${f.display}` : ""}`
                : t("settings.notSet")}{" "}
              · {f.required ? t("settings.required") : t("settings.optional")}
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            {f.help}{" "}
            {f.url && (
              <a href={f.url} target="_blank" rel="noreferrer" className="underline">
                {t("settings.getIt")} ↗
              </a>
            )}
          </p>
          {f.kind === "select" ? (
            <select
              id={`s-${f.key}`}
              name={f.key}
              defaultValue={f.display || f.options?.[0]?.value}
              className={INPUT}
            >
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`s-${f.key}`}
              name={f.key}
              type={f.kind === "secret" ? "password" : "text"}
              autoComplete="off"
              placeholder={f.isSet ? t("settings.placeholderKeep") : ""}
              defaultValue={f.kind === "text" ? f.display : undefined}
              className={INPUT}
            />
          )}
          <div className="mt-2 flex flex-wrap items-center gap-4">
            {f.test && <TestButton which={f.test} locale={locale} />}
            {f.isSet && f.kind !== "select" && (
              <label className="inline-flex items-center gap-1 text-xs text-[var(--color-muted)]">
                <input type="checkbox" name={`clear:${f.key}`} /> {t("settings.clear")}
              </label>
            )}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={`${BUTTON} bg-[var(--color-accent)] text-[var(--color-accent-ink)]`}
        >
          {pending ? t("settings.saving") : t("settings.save")}
        </button>
        {state && (
          <span role="status" className="text-sm">
            {state.ok ? t("settings.saved") : t("settings.error", { detail: state.error })}
          </span>
        )}
      </div>
    </form>
  );
}
