import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { getBrand, getBrandKit, listAssets } from "@/lib/bridge";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { KitEditor, type KitLogoOption } from "@/components/KitEditor";
import { KitLeadBaseField } from "@/components/LeadLinkKitBaseField";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("accounts.kit.title") };
}

/**
 * The brand kit editor (§6.S13). Logo candidates are this brand's images plus
 * unsorted ones, newest first (one library page each), plus the current logo
 * if it has aged out of both.
 */
export default async function BrandKitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const [brand, kit, locale] = await Promise.all([getBrand(id), getBrandKit(id), getLocale()]);
  if (!brand) notFound();
  const t = translator(locale);
  const [own, unsorted] = await Promise.all([
    listAssets({ brandId: id, kind: "image" }),
    listAssets({ unsorted: true, kind: "image" }),
  ]);
  const seen = new Set<number>();
  const logoOptions: KitLogoOption[] = [];
  for (const a of [...own.assets, ...unsorted.assets]) {
    if (a.status === "rejected" || a.status === "archived") continue;
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    const name = a.localPath?.split("/").pop() ?? a.sourceRef ?? `#${a.id}`;
    logoOptions.push({ id: a.id, label: `#${a.id} · ${name}`, hasThumb: !!a.thumbPath });
  }
  if (kit?.logoAssetId && !seen.has(kit.logoAssetId)) {
    logoOptions.unshift({ id: kit.logoAssetId, label: `#${kit.logoAssetId}`, hasThumb: false });
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Link
        href={`/brands/${brand.id}`}
        className="text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
      >
        ← {brand.name}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
        {t("accounts.kit.title")}
      </h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        {t("accounts.kit.intro", { brand: brand.name })}
      </p>
      <p className="mt-1 mb-6 text-xs text-[var(--color-ink-muted)]">
        {kit
          ? t("accounts.kit.updated", { date: kit.updatedAt.toISOString().slice(0, 10) })
          : t("accounts.kit.new")}
      </p>
      <KitEditor
        brandId={brand.id}
        kit={kit}
        logoOptions={logoOptions}
        locale={locale}
        canEdit={isOwner(user)}
      />
      {isOwner(user) && (
        <div className="mt-6">
          <KitLeadBaseField brandId={brand.id} current={kit?.leadBaseUrl ?? null} />
        </div>
      )}
    </main>
  );
}
