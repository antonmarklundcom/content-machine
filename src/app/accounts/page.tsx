import type { Metadata } from "next";
import Link from "next/link";
import {
  ACCOUNT_STATUSES,
  SOCIAL_PLATFORMS,
  type AccountStatus,
  type SocialPlatform,
} from "@/db/schema";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { listAccounts } from "@/lib/bridge";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { CARD, FIELD, LABEL, SECONDARY } from "@/components/AccountFields";
import { AccountRow } from "@/components/AccountRow";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("accounts.title") };
}

function pick<T extends string>(values: readonly T[], value: string | undefined): T | undefined {
  return (values as readonly string[]).includes(value ?? "") ? (value as T) : undefined;
}

/** Every account across brands, filterable by platform and status (§6.S13). */
export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ platform?: string; status?: string }>;
}) {
  const params = await searchParams;
  const user = await requireUser();
  const locale = await getLocale();
  const t = translator(locale);
  const platform = pick<SocialPlatform>(SOCIAL_PLATFORMS, params.platform);
  const status = pick<AccountStatus>(ACCOUNT_STATUSES, params.status);
  const accounts = await listAccounts({ platform, status });

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Link
        href="/brands"
        className="text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
      >
        {t("accounts.brands.back")}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
        {t("accounts.title")}
      </h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{t("accounts.intro")}</p>

      <form method="get" className="mt-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("accounts.filter.platform")}</span>
          <select name="platform" defaultValue={platform ?? ""} className={FIELD}>
            <option value="">{t("accounts.filter.all")}</option>
            {SOCIAL_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{t("accounts.filter.status")}</span>
          <select name="status" defaultValue={status ?? ""} className={FIELD}>
            <option value="">{t("accounts.filter.all")}</option>
            {ACCOUNT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`accounts.status.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={SECONDARY}>
          {t("accounts.filter.apply")}
        </button>
      </form>

      {accounts.length === 0 ? (
        <p className={`${CARD} mt-6 text-center text-sm text-[var(--color-ink-muted)]`}>
          {t("accounts.empty")}
        </p>
      ) : (
        <ul className="surface-border mt-6 divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-md)] bg-[var(--color-surface-raised)]">
          {accounts.map((a) => (
            <AccountRow key={a.id} account={a} locale={locale} canEdit={isOwner(user)} showBrand />
          ))}
        </ul>
      )}
    </main>
  );
}
