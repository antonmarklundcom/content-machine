import type { Metadata } from "next";
import Link from "next/link";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { listAccounts, listAllBrands, listFamilies } from "@/lib/bridge";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { CARD } from "@/components/AccountFields";
import { BrandForm } from "./BrandForm";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("accounts.brands.title") };
}

/** Every brand, grouped by nothing: name order, with family and account count (§6.S13). */
export default async function BrandsPage() {
  const user = await requireUser();
  const locale = await getLocale();
  const t = translator(locale);
  const [brands, families, accounts] = await Promise.all([
    listAllBrands(),
    listFamilies(),
    listAccounts(),
  ]);
  const familyName = new Map(families.map((f) => [f.id, f.name]));
  const accountCount = new Map<string, number>();
  for (const a of accounts) accountCount.set(a.brandId, (accountCount.get(a.brandId) ?? 0) + 1);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
        {t("accounts.eyebrow")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
        {t("accounts.brands.title")}
      </h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{t("accounts.brands.intro")}</p>
      <nav className="mt-3 flex gap-4 text-sm">
        <Link href="/families" className="text-[var(--color-accent)] hover:underline">
          {t("accounts.families.title")}
        </Link>
        <Link href="/accounts" className="text-[var(--color-accent)] hover:underline">
          {t("accounts.title")}
        </Link>
      </nav>

      {brands.length === 0 ? (
        <p className={`${CARD} mt-6 text-center text-sm text-[var(--color-ink-muted)]`}>
          {t("accounts.brands.empty")}
        </p>
      ) : (
        <ul className="surface-border mt-6 divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-md)] bg-[var(--color-surface-raised)]">
          {brands.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
              <Link
                href={`/brands/${b.id}`}
                className={`font-medium hover:text-[var(--color-accent)] ${
                  b.active ? "text-[var(--color-ink)]" : "text-[var(--color-ink-muted)]"
                }`}
              >
                {b.name}
              </Link>
              <span className="text-xs text-[var(--color-ink-muted)]">
                {b.id} · {b.language} · {b.market}
                {!b.active && ` · ${t("accounts.brands.inactive")}`}
              </span>
              <span className="ml-auto flex gap-3 text-xs text-[var(--color-ink-muted)]">
                <span>
                  {b.familyId
                    ? (familyName.get(b.familyId) ?? b.familyId)
                    : t("accounts.brands.noFamily")}
                </span>
                <span>
                  {t("accounts.brands.accountCount", { count: accountCount.get(b.id) ?? 0 })}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {isOwner(user) && (
        <details className={`${CARD} mt-6`}>
          <summary className="cursor-pointer text-sm font-semibold text-[var(--color-ink)]">
            {t("accounts.brands.new")}
          </summary>
          <div className="mt-4">
            <BrandForm
              families={families.map((f) => ({ id: f.id, name: f.name }))}
              locale={locale}
            />
          </div>
        </details>
      )}
    </main>
  );
}
