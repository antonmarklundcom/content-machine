"use client";

import { useCallback, useState } from "react";
import type { AccountWithBrand } from "@/lib/bridge/accounts";
import { translator, type Locale } from "@/lib/i18n";
import { SECONDARY } from "./AccountFields";
import { AccountForm } from "./AccountForm";
import { AccountStatusSelect } from "./AccountStatusSelect";

/**
 * One account in a list: platform, handle, language, status and the Pro flag.
 * The owner gets the status select and an inline edit form; everyone else reads.
 */
export function AccountRow({
  account,
  locale,
  canEdit,
  showBrand = false,
}: {
  account: AccountWithBrand;
  locale: Locale;
  canEdit: boolean;
  showBrand?: boolean;
}) {
  const t = translator(locale);
  const [editing, setEditing] = useState(false);
  const close = useCallback(() => setEditing(false), []);

  return (
    <li className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="w-20 shrink-0 text-xs font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
          {account.platform}
        </span>
        <span className="font-medium text-[var(--color-ink)]">@{account.handle}</span>
        {showBrand && (
          <a
            href={`/brands/${account.brandId}`}
            className="text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
          >
            {account.brandName}
          </a>
        )}
        <span className="text-xs text-[var(--color-ink-muted)]">{account.effectiveLanguage}</span>
        {account.isProfessional && (
          <span className="rounded-full border border-[var(--color-accent)] px-2 text-xs text-[var(--color-accent)]">
            {t("accounts.professional")}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {canEdit ? (
            <>
              <AccountStatusSelect accountId={account.id} status={account.status} locale={locale} />
              {!editing && (
                <button type="button" onClick={() => setEditing(true)} className={SECONDARY}>
                  {t("accounts.edit")}
                </button>
              )}
            </>
          ) : (
            <span className="text-xs text-[var(--color-ink-muted)]">
              {t(`accounts.status.${account.status}`)}
            </span>
          )}
        </span>
      </div>
      {account.notes && !editing && (
        <p className="text-xs text-[var(--color-ink-muted)]">{account.notes}</p>
      )}
      {editing && (
        <AccountForm
          brandId={account.brandId}
          initial={account}
          locale={locale}
          onDone={close}
          onCancel={close}
        />
      )}
    </li>
  );
}
