"use client";

import { useState, useTransition } from "react";
import { ACCOUNT_STATUSES, type AccountStatus } from "@/db/schema";
import { setAccountStatusAction } from "@/lib/accounts.actions";
import { translator, type Locale } from "@/lib/i18n";

/** The one-click status change on an account row; shows the refusal inline. */
export function AccountStatusSelect({
  accountId,
  status,
  locale,
}: {
  accountId: number;
  status: AccountStatus;
  locale: Locale;
}) {
  const t = translator(locale);
  const [value, setValue] = useState(status);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span className="inline-flex items-center gap-2">
      <select
        aria-label={t("accounts.setStatus")}
        value={value}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.value as AccountStatus;
          const previous = value;
          setValue(next);
          setError(null);
          startTransition(async () => {
            const res = await setAccountStatusAction(accountId, next);
            if (!res.ok) {
              setValue(previous);
              setError(res.error);
            }
          });
        }}
        className="surface-border rounded-[var(--radius-sm)] bg-[var(--color-surface-raised)] px-2 py-1 text-xs text-[var(--color-ink)] disabled:opacity-60"
      >
        {ACCOUNT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(`accounts.status.${s}`)}
          </option>
        ))}
      </select>
      {error && (
        <span role="alert" className="text-xs text-[var(--color-danger)]">
          {error}
        </span>
      )}
    </span>
  );
}
