"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { SOCIAL_PLATFORMS, type Brand } from "@/db/schema";
import { saveBrandAction, type AccountsActionResult } from "@/lib/accounts.actions";
import { translator, type Locale } from "@/lib/i18n";
import { AccountSubmitRow, FIELD, LABEL } from "@/components/AccountFields";

/**
 * Create or edit a brand (PLAN.md §6.S13). The id is the slug and is read-only
 * once the brand exists: other tables point at it by value. A new brand opens
 * its own page, where its accounts are added.
 */
export function BrandForm({
  initial,
  families,
  locale,
}: {
  initial?: Brand;
  families: { id: string; name: string }[];
  locale: Locale;
}) {
  const t = translator(locale);
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    saveBrandAction,
    null as AccountsActionResult<{ id: string }> | null,
  );
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && !initial) router.push(`/brands/${state.id}`);
  }, [state, initial, router]);

  const idp = `brand-${initial?.id ?? "new"}`;
  const field = (name: string, label: string, props: React.ComponentProps<"input"> = {}) => (
    <label className="flex flex-col gap-1" htmlFor={`${idp}-${name}`}>
      <span className={LABEL}>{label}</span>
      <input id={`${idp}-${name}`} name={name} className={FIELD} {...props} />
    </label>
  );

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="mode" value={initial ? "edit" : "create"} />
      <div className="grid gap-3 sm:grid-cols-3">
        {field("id", t("accounts.brand.field.id"), {
          required: true,
          readOnly: !!initial,
          defaultValue: initial?.id,
          pattern: "[a-z0-9]+(-[a-z0-9]+)*",
          placeholder: "my-brand",
        })}
        {field("name", t("accounts.brand.field.name"), {
          required: true,
          defaultValue: initial?.name,
        })}
        {field("domain", t("accounts.brand.field.domain"), {
          defaultValue: initial?.domain,
          placeholder: "example.com",
        })}
        {field("niche", t("accounts.brand.field.niche"), {
          required: true,
          defaultValue: initial?.niche,
        })}
        {field("market", t("accounts.brand.field.market"), {
          required: true,
          defaultValue: initial?.market,
          placeholder: "paraguay",
        })}
        {field("language", t("accounts.brand.field.language"), {
          required: true,
          defaultValue: initial?.language ?? "en",
          placeholder: "en",
        })}
      </div>
      <label className="flex flex-col gap-1" htmlFor={`${idp}-family`}>
        <span className={LABEL}>{t("accounts.brand.field.family")}</span>
        <select
          id={`${idp}-family`}
          name="familyId"
          defaultValue={initial?.familyId ?? ""}
          className={`${FIELD} max-w-80`}
        >
          <option value="">{t("accounts.brands.noFamily")}</option>
          {families.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1" htmlFor={`${idp}-voice`}>
        <span className={LABEL}>{t("accounts.brand.field.voice")}</span>
        <textarea
          id={`${idp}-voice`}
          name="voice"
          rows={2}
          defaultValue={initial?.voice ?? ""}
          className={FIELD}
        />
      </label>
      <fieldset className="flex flex-col gap-1">
        <legend className={LABEL}>{t("accounts.brand.field.platforms")}</legend>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
          {SOCIAL_PLATFORMS.map((p) => (
            <label key={p} className="flex items-center gap-1.5 text-sm text-[var(--color-ink)]">
              <input
                type="checkbox"
                name="platforms"
                value={p}
                defaultChecked={initial?.platforms.includes(p) ?? false}
              />
              {p}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm text-[var(--color-ink)]">
        <input type="checkbox" name="active" defaultChecked={initial?.active ?? true} />
        {t("accounts.brand.field.active")}
      </label>
      <AccountSubmitRow
        locale={locale}
        label={initial ? t("accounts.save") : t("accounts.brands.create")}
        pending={pending}
        state={state}
      />
    </form>
  );
}
