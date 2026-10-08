import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { getBrand, listAccounts, listFamilies } from "@/lib/bridge";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { CARD } from "@/components/AccountFields";
import { AccountForm } from "@/components/AccountForm";
import { AccountRow } from "@/components/AccountRow";
import { BrandForm } from "../BrandForm";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const brand = await getBrand((await params).id);
  return { title: brand?.name ?? translator(await getLocale())("accounts.brands.title") };
}

/** One brand: its details (editable by the owner), its accounts, and links to ideas and kit. */
export default async function BrandSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const [brand, locale] = await Promise.all([getBrand(id), getLocale()]);
  if (!brand) notFound();
  const t = translator(locale);
  const canEdit = isOwner(user);
  const [accounts, families] = await Promise.all([listAccounts({ brandId: id }), listFamilies()]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Link
        href="/brands"
        className="text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
      >
        {t("accounts.brands.back")}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
        {brand.name}
      </h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        {brand.id} · {brand.niche} · {brand.market} · {brand.language}
        {!brand.active && ` · ${t("accounts.brands.inactive")}`}
      </p>
      <nav className="mt-3 flex gap-4 text-sm">
        <Link href={`/brand/${brand.id}`} className="text-[var(--color-accent)] hover:underline">
          {t("accounts.brands.openIdeas")}
        </Link>
        <Link
          href={`/brand/${brand.id}/kit`}
          className="text-[var(--color-accent)] hover:underline"
        >
          {t("accounts.brands.openKit")}
        </Link>
      </nav>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">{t("accounts.title")}</h2>
        {accounts.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{t("accounts.emptyBrand")}</p>
        ) : (
          <ul className="surface-border mt-3 divide-y divide-[var(--color-border-subtle)] rounded-[var(--radius-md)] bg-[var(--color-surface-raised)]">
            {accounts.map((a) => (
              <AccountRow key={a.id} account={a} locale={locale} canEdit={canEdit} />
            ))}
          </ul>
        )}
        {canEdit && (
          <details className={`${CARD} mt-4`}>
            <summary className="cursor-pointer text-sm font-semibold text-[var(--color-ink)]">
              {t("accounts.add")}
            </summary>
            <div className="mt-4">
              <AccountForm brandId={brand.id} locale={locale} />
            </div>
          </details>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--color-ink)]">
          {t("accounts.brands.details")}
        </h2>
        {canEdit ? (
          <div className={`${CARD} mt-3`}>
            <BrandForm
              initial={brand}
              families={families.map((f) => ({ id: f.id, name: f.name }))}
              locale={locale}
            />
          </div>
        ) : (
          <p className="mt-2 text-sm text-[var(--color-ink-muted)]">{t("accounts.ownerOnly")}</p>
        )}
      </section>
    </main>
  );
}
