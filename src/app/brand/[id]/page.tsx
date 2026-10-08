import Link from "next/link";
import { notFound } from "next/navigation";
import { getBrand, isIdeaStatus, listAnalyzedVideos } from "@/lib/bridge";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import BrandIdeas from "./BrandIdeas";

// The brand list comes from the `brands` table now (PLAN.md §1.5), so this
// page reads the database on every request — it can't be prerendered at build
// time on a machine with no DATABASE_URL, and a brand edited in the table
// should show up without a redeploy. Same reasoning as /youtube's layout.
export const dynamic = "force-dynamic";

export default async function BrandPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const status = isIdeaStatus(query.status) ? query.status : undefined;
  const page = Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1);
  const [brand, analyzedVideos, locale] = await Promise.all([
    getBrand(id),
    listAnalyzedVideos(),
    getLocale(),
  ]);
  if (!brand) notFound();
  const t = translator(locale);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link
        href="/brands"
        className="text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
      >
        {t("brands.back")}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
        {brand.name}
      </h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        {brand.niche} · {brand.market} · {brand.platforms.join(", ")}
      </p>
      <p className="mt-2 flex flex-wrap gap-4 text-sm">
        <Link
          href={`/brands/${encodeURIComponent(brand.id)}`}
          className="text-[var(--color-accent)] hover:underline"
        >
          {t("links.brandAccounts")}
        </Link>
        <Link
          href={`/brand/${encodeURIComponent(brand.id)}/kit`}
          className="text-[var(--color-accent)] hover:underline"
        >
          {t("links.brandKit")}
        </Link>
      </p>
      <BrandIdeas
        brandId={brand.id}
        analyzedVideos={analyzedVideos}
        locale={locale}
        status={status}
        page={page}
      />
    </main>
  );
}
