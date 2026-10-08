"use client";

import { useState, useTransition } from "react";

import { higgsfieldPreflightAction } from "@/lib/higgsfield.actions";
import type { Preflight } from "@/lib/higgsfield/preflight";
import { useTranslator } from "@/lib/i18n/client";

import { ResultMessage } from "./ResultMessage";
import { STUDIO_BUTTON } from "./StudioStyles";

/** The /higgsfield readiness panel: four checks, each with its fix (build 4 §3.H). */
export function HiggsfieldPreflight({ initial }: { initial: Preflight | null }) {
  const t = useTranslator();
  const [preflight, setPreflight] = useState<Preflight | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function check() {
    setError(null);
    start(async () => {
      const result = await higgsfieldPreflightAction();
      if (result.ok) setPreflight(result.preflight);
      else setError(result.error);
    });
  }

  return (
    <section className="surface-border rounded-[var(--radius-md)] bg-[var(--color-surface-raised)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">
          {t("higgsfield.preflight.title")}{" "}
          {preflight && (
            <span
              className={`ml-2 text-sm ${preflight.ok ? "text-[var(--color-accent)]" : "text-[var(--color-danger)]"}`}
            >
              {t(preflight.ok ? "higgsfield.preflight.ok" : "higgsfield.preflight.failed")}
            </span>
          )}
        </h2>
        <button type="button" className={STUDIO_BUTTON} onClick={check} disabled={pending}>
          {pending ? t("higgsfield.preflight.checking") : t("higgsfield.preflight.check")}
        </button>
      </div>
      {error && <ResultMessage tone="error">{error}</ResultMessage>}
      {!preflight ? (
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          {t("higgsfield.preflight.notChecked")}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {preflight.checks.map((c) => (
            <li key={c.id}>
              <span
                className={c.ok ? "text-[var(--color-accent)]" : "text-[var(--color-danger)]"}
                aria-hidden
              >
                {c.ok ? "✓" : "✗"}
              </span>{" "}
              <span className="font-medium text-[var(--color-ink)]">
                {t(`higgsfield.check.${c.id}`)}
              </span>
              <span className="ml-2 text-xs break-all text-[var(--color-ink-muted)]">
                {c.detail}
              </span>
              {c.fix && (
                <p className="mt-1 ml-5 text-[var(--color-ink)]">{t(`higgsfield.fix.${c.fix}`)}</p>
              )}
            </li>
          ))}
          <li className="text-xs text-[var(--color-ink-muted)]">
            {t("higgsfield.preflight.checkedAt", {
              time: new Date(preflight.checkedAt).toLocaleString(),
            })}
          </li>
        </ul>
      )}
    </section>
  );
}
