"use client";

import { useActionState, useEffect, useRef } from "react";
import type { BrandFamily } from "@/db/schema";
import { saveFamilyAction, type AccountsActionResult } from "@/lib/accounts.actions";
import { translator, type Locale } from "@/lib/i18n";
import { AccountSubmitRow, FIELD, LABEL } from "./AccountFields";

/** Create a family, or rename one (its id is permanent, like a brand's). */
export function FamilyForm({
  initial,
  locale,
  onDone,
  onCancel,
}: {
  initial?: BrandFamily;
  locale: Locale;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const t = translator(locale);
  const [state, formAction, pending] = useActionState(
    saveFamilyAction,
    null as AccountsActionResult<{ id: string }> | null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state?.ok) return;
    if (onDone) onDone();
    else formRef.current?.reset();
  }, [state, onDone]);

  const idp = `family-${initial?.id ?? "new"}`;
  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="mode" value={initial ? "edit" : "create"} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1" htmlFor={`${idp}-id`}>
          <span className={LABEL}>{t("accounts.family.field.id")}</span>
          <input
            id={`${idp}-id`}
            name="id"
            required
            readOnly={!!initial}
            defaultValue={initial?.id}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            placeholder="paraguay-residency"
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1" htmlFor={`${idp}-name`}>
          <span className={LABEL}>{t("accounts.family.field.name")}</span>
          <input
            id={`${idp}-name`}
            name="name"
            required
            defaultValue={initial?.name}
            className={FIELD}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1" htmlFor={`${idp}-notes`}>
        <span className={LABEL}>{t("accounts.family.field.notes")}</span>
        <textarea
          id={`${idp}-notes`}
          name="notes"
          rows={2}
          defaultValue={initial?.notes ?? ""}
          className={FIELD}
        />
      </label>
      <AccountSubmitRow
        locale={locale}
        label={initial ? t("accounts.save") : t("accounts.families.create")}
        pending={pending}
        state={state}
        onCancel={onCancel}
      />
    </form>
  );
}
