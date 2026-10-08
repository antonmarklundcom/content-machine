import type { Metadata } from "next";

import { GapCard, type GapCardData } from "@/components/GapCard";
import { GapRunButton } from "@/components/GapRunButton";
import { isOwner } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { listBrands } from "@/lib/bridge/brands";
import {
  estimateGapsCostUsd,
  evidenceLinks,
  gatherGapInputs,
  GAP_LOOKBACK_DAYS,
  listGaps,
} from "@/lib/gaps/find";
import { translator } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n/server";
import { formatUsd } from "@/lib/spend";

export async function generateMetadata(): Promise<Metadata> {
  return { title: translator(await getLocale())("growth.gaps.title") };
}

const CHIP =
  "rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]";
const CHIP_ON = `${CHIP} bg-[var(--color-accent)] text-[var(--color-accent-ink)]`;
const CHIP_OFF = `${CHIP} surface-border text-[var(--color-ink)] hover:border-[var(--color-accent)]`;

/**
 * `/research/gaps?brand=<id>` — topics competitors post about or the audience
 * asks about that the brand has not covered (build 4 §3.G), best score first.
 */
export default async function GapsPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string; show?: string }>;
}) {
  const [params, brands, locale, user] = await Promise.all([
    searchParams,
    listBrands(),
    getLocale(),
    requireUser(),
  ]);
  const t = translator(locale);
  const brand = brands.find((b) => b.id === params.brand) ?? brands[0];
  const showDismissed = params.show === "dismissed";

  const [inputs, gaps] = brand
    ? await Promise.all([
        gatherGapInputs(brand.id),
        listGaps(brand.id, showDismissed ? ["dismissed"] : ["new", "planned"]),
      ])
    : [null, []];
  const links = await evidenceLinks(gaps);
  const cards: GapCardData[] = gaps.map((g) => ({
    id: g.id,
    brandId: g.brandId,
    topic: g.topic,
    angle: g.angle,
    score: g.score,
    status: g.status,
    ideaId: g.ideaId,
    evidence: g.evidence.map((e) => ({ ...e, href: links.get(e.ref) ?? null })),
  }));
  const counts = inputs
    ? {
        cp: inputs.market.filter((i) => i.kind === "competitor_post").length,
        reports: inputs.market.filter((i) => i.kind === "report").length,
        questions: inputs.market.filter((i) => i.kind === "question").length,
        own: inputs.own.length,
      }
    : null;
  const brandHref = (id: string, show?: string) =>
    `/research/gaps?${new URLSearchParams({ brand: id, ...(show ? { show } : {}) })}`;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
        {t("growth.eyebrow")}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-[var(--color-ink)]">
        {t("growth.gaps.title")}
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-muted)]">
        {t("growth.gaps.intro")}
      </p>

      {!brand || !counts ? (
        <p className="mt-8 text-sm text-[var(--color-ink-muted)]">{t("growth.noBrands")}</p>
      ) : (
        <>
          <nav aria-label={t("growth.brand")} className="mt-6 flex flex-wrap gap-2">
            {brands.map((b) => (
              <a
                key={b.id}
                href={brandHref(b.id)}
                aria-current={b.id === brand.id ? "page" : undefined}
                className={b.id === brand.id ? CHIP_ON : CHIP_OFF}
              >
                {b.name}
              </a>
            ))}
          </nav>

          <section className="surface-border mt-6 rounded-[var(--radius-sm)] p-4">
            <p className="text-sm text-[var(--color-ink)]">
              {t("growth.gaps.inputs", {
                days: GAP_LOOKBACK_DAYS,
                cp: counts.cp,
                reports: counts.reports,
                questions: counts.questions,
                own: counts.own,
              })}
            </p>
            {counts.cp + counts.reports + counts.questions === 0 ? (
              <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
                {t("growth.gaps.nothingToCompare")}
              </p>
            ) : null}
            {isOwner(user) ? (
              <div className="mt-3">
                <GapRunButton
                  brandId={brand.id}
                  estimate={formatUsd(estimateGapsCostUsd())}
                  disabled={counts.cp + counts.reports + counts.questions === 0}
                />
              </div>
            ) : null}
          </section>

          <div className="mt-8 flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-semibold text-[var(--color-ink)]">
              {showDismissed ? t("growth.gaps.dismissedTitle") : t("growth.gaps.listTitle")}
            </h2>
            <a
              href={brandHref(brand.id, showDismissed ? undefined : "dismissed")}
              className="text-xs underline text-[var(--color-ink-muted)] hover:text-[var(--color-accent)]"
            >
              {showDismissed ? t("growth.gaps.showOpen") : t("growth.gaps.showDismissed")}
            </a>
          </div>
          {cards.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--color-ink-muted)]">{t("growth.gaps.none")}</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-4">
              {cards.map((g) => (
                <GapCard key={g.id} gap={g} />
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
