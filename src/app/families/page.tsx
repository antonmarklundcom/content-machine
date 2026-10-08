import type { Metadata } from "next";
import Link from "next/link";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { listFamiliesWithBrands } from "@/lib/bridge";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { CARD } from "@/components/AccountFields";
import { FamilyCard } from "@/components/FamilyCard";
import { FamilyForm } from "@/components/FamilyForm";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("accounts.families.title") };
}

/** Families and their brands (§1.40). A brand joins a family from its own page. */
export default async function FamiliesPage() {
  const user = await requireUser();
  const locale = await getLocale();
  const t = translator(locale);
  const families = await listFamiliesWithBrands();
  const canEdit = isOwner(user);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Link
        href="/brands"
        className="text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
      >
        {t("accounts.brands.back")}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
        {t("accounts.families.title")}
      </h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{t("accounts.families.intro")}</p>

      {families.length === 0 ? (
        <p className={`${CARD} mt-6 text-center text-sm text-[var(--color-ink-muted)]`}>
          {t("accounts.families.empty")}
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          {families.map(({ brands, ...family }) => (
            <FamilyCard
              key={family.id}
              family={family}
              brands={brands.map((b) => ({
                id: b.id,
                name: b.name,
                language: b.language,
                active: b.active,
              }))}
              locale={locale}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}

      {canEdit && (
        <details className={`${CARD} mt-6`}>
          <summary className="cursor-pointer text-sm font-semibold text-[var(--color-ink)]">
            {t("accounts.families.new")}
          </summary>
          <div className="mt-4">
            <FamilyForm locale={locale} />
          </div>
        </details>
      )}
    </main>
  );
}
