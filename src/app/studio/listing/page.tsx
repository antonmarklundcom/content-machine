import Link from "next/link";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { listBrands } from "@/lib/bridge";
import { defaultScriptLanguage } from "@/lib/scripts/language";
import { getLocale } from "@/lib/i18n/server";
import { translator } from "@/lib/i18n";
import { ListingForm } from "@/components/ListingForm";

/** The brand a listing script is for unless `?brand=` says otherwise. */
const DEFAULT_BRAND = "propia";

/**
 * `/studio/listing` — a property listing → a short or a tour (build 2b, idea
 * 8). The form and both steps are client-side; the actions are in
 * `src/lib/listing.actions.ts`.
 */
export default async function ListingScriptPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const t = translator(await getLocale());
  const wanted = (await searchParams).brand;
  const brands = await listBrands();
  const brand =
    brands.find((b) => b.id === wanted) ?? brands.find((b) => b.id === DEFAULT_BRAND) ?? brands[0];

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href="/studio"
        className="text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
      >
        &larr; {t("studio.back")}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold text-[var(--color-ink)]">{t("listing.title")}</h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">
        {t("listing.intro")}
      </p>
      {!brand ? (
        <p className="mt-3 text-sm text-[var(--color-ink-muted)]">{t("listing.noBrands")}</p>
      ) : (
        <>
          {!isOwner(user) && (
            <p className="mt-3 text-sm text-[var(--color-warn)]">{t("listing.ownerOnly")}</p>
          )}
          <ListingForm
            brands={brands.map((b) => ({
              id: b.id,
              name: b.name,
              language: defaultScriptLanguage(b),
            }))}
            brandId={brand.id}
          />
        </>
      )}
    </div>
  );
}
