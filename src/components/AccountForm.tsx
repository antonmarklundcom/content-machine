"use client";

import { useActionState, useEffect, useRef } from "react";
import { ACCOUNT_STATUSES, SOCIAL_PLATFORMS, type SocialAccount } from "@/db/schema";
import { saveAccountAction, type AccountsActionResult } from "@/lib/accounts.actions";
import { translator, type Locale } from "@/lib/i18n";
import { AccountSubmitRow, FIELD, LABEL } from "./AccountFields";

/**
 * Add an account to a brand, or edit one (PLAN.md §6.S13). A successful add
 * clears the form; a successful edit calls `onDone` so the row closes.
 */
export function AccountForm({
  brandId,
  initial,
  locale,
  onDone,
  onCancel,
}: {
  brandId: string;
  initial?: SocialAccount;
  locale: Locale;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const t = translator(locale);
  const [state, formAction, pending] = useActionState(
    saveAccountAction,
    null as AccountsActionResult<{ id: number }> | null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state?.ok) return;
    if (onDone) onDone();
    else formRef.current?.reset();
  }, [state, onDone]);

  const idp = `account-${initial?.id ?? "new"}`;
  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="brandId" value={brandId} />
      {initial && <input type="hidden" name="accountId" value={initial.id} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1" htmlFor={`${idp}-platform`}>
          <span className={LABEL}>{t("accounts.field.platform")}</span>
          <select
            id={`${idp}-platform`}
            name="platform"
            defaultValue={initial?.platform ?? "instagram"}
            className={FIELD}
          >
            {SOCIAL_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1" htmlFor={`${idp}-handle`}>
          <span className={LABEL}>{t("accounts.field.handle")}</span>
          <input
            id={`${idp}-handle`}
            name="handle"
            required
            defaultValue={initial?.handle}
            placeholder="@handle"
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1" htmlFor={`${idp}-language`}>
          <span className={LABEL}>{t("accounts.field.language")}</span>
          <input
            id={`${idp}-language`}
            name="language"
            defaultValue={initial?.language ?? ""}
            placeholder={t("accounts.field.languageHint")}
            className={FIELD}
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1" htmlFor={`${idp}-status`}>
          <span className={LABEL}>{t("accounts.field.status")}</span>
          <select
            id={`${idp}-status`}
            name="status"
            defaultValue={initial?.status ?? "planned"}
            className={FIELD}
          >
            {ACCOUNT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`accounts.status.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--color-ink)] sm:col-span-2 sm:pt-5">
          <input
            type="checkbox"
            name="isProfessional"
            defaultChecked={initial?.isProfessional ?? false}
          />
          {t("accounts.field.professional")}
        </label>
      </div>
      <label className="flex flex-col gap-1" htmlFor={`${idp}-notes`}>
        <span className={LABEL}>{t("accounts.field.notes")}</span>
        <textarea
          id={`${idp}-notes`}
          name="notes"
          rows={1}
          defaultValue={initial?.notes ?? ""}
          className={FIELD}
        />
      </label>
      <AccountSubmitRow
        locale={locale}
        label={initial ? t("accounts.save") : t("accounts.add")}
        pending={pending}
        state={state}
        onCancel={onCancel}
      />
    </form>
  );
}
