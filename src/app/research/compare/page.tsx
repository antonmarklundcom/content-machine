import type { Metadata } from "next";
import { CompareChannelCard } from "@/components/CompareChannelCard";
import { CompareOwnChannelForm } from "@/components/CompareOwnChannelForm";
import { CompareTitles } from "@/components/CompareTitles";
import { requireUser } from "@/lib/auth/session";
import { listBrands } from "@/lib/bridge/brands";
import { compareBrandChannels } from "@/lib/bridge/compare";
import { translator } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("compare.title") };
}

const CHIP =
  "rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
const CHIP_ON = `${CHIP} bg-[var(--color-accent)] text-[var(--color-accent-ink)]`;
const CHIP_OFF = `${CHIP} surface-border text-[var(--color-ink)] hover:border-[var(--color-accent)]`;

/**
 * Own channel vs competitors (build 2b, idea 4). `?brand=` picks the brand;
 * the channel linked with role `own` comes first.
 */
export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>;
}) {
  const [params, , brands, locale] = await Promise.all([
    searchParams,
    requireUser(),
    listBrands(),
    getLocale(),
  ]);
  const t = translator(locale);
  const brand = brands.find((b) => b.id === params.brand) ?? brands[0];
  const comparison = brand ? await compareBrandChannels(brand.id) : null;
  const hasOwn = comparison?.channels.some((c) => c.role === "own") ?? false;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
        {t("compare.eyebrow")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">{t("compare.title")}</h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">
        {t("compare.intro")}
      </p>

      {!brand || !comparison ? (
        <p className="mt-8 text-sm text-[var(--color-ink-muted)]">{t("compare.noBrands")}</p>
      ) : (
        <>
          <nav aria-label={t("compare.brand")} className="mt-6 flex flex-wrap items-center gap-2">
            {brands.map((b) => (
              <a
                key={b.id}
                href={`/research/compare?${new URLSearchParams({ brand: b.id })}`}
                aria-current={b.id === brand.id ? "page" : undefined}
                className={b.id === brand.id ? CHIP_ON : CHIP_OFF}
              >
                {b.name}
              </a>
            ))}
            <a
              href={`/research?${new URLSearchParams({ brand: brand.id })}`}
              className="ml-auto text-xs text-[var(--color-accent)] hover:underline"
            >
              {t("compare.backToResearch")}
            </a>
          </nav>

          {!hasOwn && (
            <section className="surface-border surface-card mt-8 p-5">
              <p className="mb-3 text-sm text-[var(--color-ink-muted)]">{t("compare.noOwn")}</p>
              <CompareOwnChannelForm key={brand.id} brandId={brand.id} locale={locale} />
            </section>
          )}

          <section className="mt-8">
            <h2 className="text-lg font-semibold text-[var(--color-ink)]">
              {t("compare.channels")}
            </h2>
            {comparison.channels.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--color-ink-muted)]">
                {t("compare.channelsEmpty")}
              </p>
            ) : (
              <ul className="mt-3 grid gap-4 md:grid-cols-2">
                {comparison.channels.map((channel) => (
                  <CompareChannelCard key={channel.sourceId} channel={channel} locale={locale} />
                ))}
              </ul>
            )}
          </section>

          <section className="surface-border surface-card mt-10 p-5">
            <h2 className="text-lg font-semibold text-[var(--color-ink)]">{t("compare.titles")}</h2>
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{t("compare.titlesNote")}</p>
            <CompareTitles
              own={comparison.ownTitles}
              competitors={comparison.competitorTitles}
              locale={locale}
            />
          </section>
        </>
      )}
    </main>
  );
}
