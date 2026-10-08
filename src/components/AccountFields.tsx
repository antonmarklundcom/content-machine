"use client";

import type { AccountsActionResult } from "@/lib/accounts.actions";
import { translator, type Locale } from "@/lib/i18n";
import { ResultMessage } from "./ResultMessage";

/**
 * The shared pieces of S13's forms (brand, family, account, kit): one field
 * style, one label style, and the submit row that shows the action's result.
 */
export const FIELD =
  "surface-border w-full rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:opacity-60";
export const LABEL = "text-xs font-medium text-[var(--color-ink-muted)]";
export const PRIMARY =
  "rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
export const SECONDARY =
  "surface-border rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium text-[var(--color-ink)] hover:border-[var(--color-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
export const CARD =
  "surface-border rounded-[var(--radius-md)] bg-[var(--color-surface-raised)] p-4";

export function AccountSubmitRow({
  locale,
  label,
  pending,
  state,
  onCancel,
}: {
  locale: Locale;
  label: string;
  pending: boolean;
  state: AccountsActionResult | null;
  onCancel?: () => void;
}) {
  const t = translator(locale);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending ? t("accounts.saving") : label}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className={SECONDARY}>
            {t("accounts.cancel")}
          </button>
        )}
      </div>
      {state &&
        (state.ok ? (
          <ResultMessage tone="success">{t("accounts.saved")}</ResultMessage>
        ) : (
          <ResultMessage tone="error">{state.error}</ResultMessage>
        ))}
    </div>
  );
}
