import type { Metadata } from "next";
import { ResearchAddChannelForm } from "@/components/ResearchAddChannelForm";
import { ResearchChannelList } from "@/components/ResearchChannelList";
import { ResearchOutlierBoard } from "@/components/ResearchOutlierBoard";
import { ResearchTitlePatterns } from "@/components/ResearchTitlePatterns";
import { isOwner } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";
import { listBrands } from "@/lib/bridge/brands";
import { listBrandCompetitors, topOutliersForBrand } from "@/lib/bridge/research";
import { translator } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("research.title") };
}

const WINDOWS = [30, 90, 365] as const;
const DEFAULT_WINDOW = 90;

const CHIP =
  "rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
const CHIP_ON = `${CHIP} bg-[var(--color-accent)] text-[var(--color-accent-ink)]`;
const CHIP_OFF = `${CHIP} surface-border text-[var(--color-ink)] hover:border-[var(--color-accent)]`;

/**
 * Competitor research (PLAN.md §6.S10). Brand and window live in the query
 * string (`?brand=pozo&days=90`) so a view is a shareable link.
 */
export default async function ResearchPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; days?: string }>;
}) {
  const [params, brands, locale, user] = await Promise.all([
    searchParams,
    listBrands(),
    getLocale(),
    getSession(),
  ]);
  const t = translator(locale);
  const brand = brands.find((b) => b.id === params.brand) ?? brands[0];
  const days = WINDOWS.find((d) => String(d) === params.days) ?? DEFAULT_WINDOW;
  const href = (brandId: string, d: number) =>
    `/research?${new URLSearchParams({ brand: brandId, days: String(d) })}`;

  const [channels, ranked] = brand
    ? await Promise.all([
        listBrandCompetitors(brand.id),
        topOutliersForBrand(brand.id, { days, limit: 20 }),
      ])
    : [[], []];
  // An outlier beats its own channel's median; the rest of the ranking is noise here.
  const outliers = ranked.filter((v) => v.score > 1);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
        {t("research.eyebrow")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">{t("research.title")}</h1>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)] leading-relaxed">
        {t("research.intro")}
      </p>

      {!brand ? (
        <p className="mt-8 text-sm text-[var(--color-ink-muted)]">{t("research.noBrands")}</p>
      ) : (
        <>
          <nav aria-label={t("research.brand")} className="mt-6 flex flex-wrap gap-2">
            {brands.map((b) => (
              <a
                key={b.id}
                href={href(b.id, days)}
                aria-current={b.id === brand.id ? "page" : undefined}
                className={b.id === brand.id ? CHIP_ON : CHIP_OFF}
              >
                {b.name}
              </a>
            ))}
          </nav>

          <section className="mt-8">
            <h2 className="text-lg font-semibold text-[var(--color-ink)]">
              {t("research.channels")}
            </h2>
            <div className="surface-border surface-card mt-3 p-5">
              <ResearchAddChannelForm key={brand.id} brandId={brand.id} locale={locale} />
            </div>
            <ResearchChannelList brandId={brand.id} channels={channels} locale={locale} />
          </section>

          <section className="mt-10">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[var(--color-ink)]">
                  {t("research.outliers")}
                </h2>
                <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                  {t("research.outliersNote")}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-ink-muted)]">
                <span>{t("research.window")}</span>
                {WINDOWS.map((d) => (
                  <a
                    key={d}
                    href={href(brand.id, d)}
                    aria-current={d === days ? "page" : undefined}
                    className={d === days ? CHIP_ON : CHIP_OFF}
                  >
                    {t("research.days", { days: d })}
                  </a>
                ))}
              </div>
            </div>
            <ResearchOutlierBoard
              brandId={brand.id}
              outliers={outliers}
              canAnalyse={isOwner(user)}
              locale={locale}
            />
          </section>

          <section className="surface-border surface-card mt-10 p-5">
            <h2 className="text-lg font-semibold text-[var(--color-ink)]">
              {t("research.titlePatterns")}
            </h2>
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
              {t("research.titlePatternsNote")}
            </p>
            <ResearchTitlePatterns outliers={outliers.slice(0, 10)} locale={locale} />
          </section>
        </>
      )}
    </main>
  );
}
